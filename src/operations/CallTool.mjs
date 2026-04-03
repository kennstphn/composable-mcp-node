import {interpolateValue} from "../functions/interpolateValue.mjs";
import {fetchToolsForCollation} from "../functions/get_tools_with_operations.mjs";
import {DEFAULT_TOOLS} from "../directus/default_tools.mjs";
import {validate_arguments} from "../functions/validate_arguments.mjs";

/**
 * CallTool operation — calls another Directus-backed tool from within a flow.
 *
 * Config schema (two equivalent forms are accepted):
 *
 * Standard form — used when configuring a call_tool operation inside a composed tool:
 * {
 *   "tool_collation": string        (optional) — the tool collation to look up the target tool in;
 *                                               omit to use the built-in default tools
 *   "tool_name":      string        (required) — name of the target tool to call
 *   "tool_arguments": object|array  (optional) — arguments to pass to the target tool; supports
 *                                               Mustache interpolation against the calling flow's context
 *   "iteration_mode": string        (optional) — if tool_arguments is an array, 'parallel' or 'serial'; defaults to 'serial'
 * }
 *
 * Invocation form — used by the HTTP/WebSocket handler in App.mjs:
 * {
 *   "invocation":     { name: string, arguments: object }  — combined collation__toolname and arguments;
 *                                                            supports Mustache interpolation
 *   "iteration_mode": string  (optional)
 * }
 *
 * Runtime requirements:
 *   - context.$env.DIRECTUS_BASE_URL — base URL of the Directus instance
 *   - bearerToken parameter           — explicitly supplied bearer token, for API calls without exposing it in the context
 *   - context.$accountability         — accountability object from the calling context;
 *                                       passed through to the sub-tool's flow unchanged
 *
 * The operation resolves with the final `$last` value produced by the target tool's flow.
 * If the target tool's flow ends with an error state, we reject with the final `$last` value from the sub-flow
 * (which should contain error details). The sub-context uses `$vars.isError` to signal to the parent flow
 * that this was an error state.
 */


export class CallTool {

  run_operations; // injected after construction
  get_fresh_vars; // injected after construction

  constructor(config) {
    this.config = config;
    if (typeof config === 'string') {
      try {
        this.config = JSON.parse(config);
      } catch (e) {
        throw new Error('CallTool: config string is not valid JSON');
      }
    }
  }

  async run(context, bearerToken) {
    if (!this.run_operations) throw new Error('CallTool: run_operations not injected');
    if (!this.get_fresh_vars)  throw new Error('CallTool: get_fresh_vars not injected');

    let { invocation, iteration_mode } = this.config;

    if (!iteration_mode) {
        iteration_mode = 'serial';
    }

    const baseUrl = context?.$env?.DIRECTUS_BASE_URL;

    if (!baseUrl) {
      throw new Error("CallTool: DIRECTUS_BASE_URL is not available in context.$env");
    }

    // Support standard config format: { tool_collation, tool_name, tool_arguments }.
    // Interpolate each field separately, then combine into the invocation object.
    if (invocation === undefined) {
        const collation  = interpolateValue(this.config.tool_collation || null, context);
        const tool_name  = interpolateValue(this.config.tool_name || null, context);
        const args       = interpolateValue(this.config.tool_arguments || {}, context);
        invocation = {
            name:      collation ? `${collation}__${tool_name}` : tool_name,
            arguments: args,
        };
        iteration_mode = interpolateValue(iteration_mode, context);
    } else {
        // Invocation form: interpolate config values against the current context, to allow dynamic
        // resolution of the target tool and arguments based on the calling flow's state.
        invocation     = interpolateValue(invocation, context);
        iteration_mode = interpolateValue(iteration_mode, context);
    }

    try{
        if ( Array.isArray(invocation) ) {
          return await this.invoke_tool_list(invocation, bearerToken, iteration_mode, context);
        }
        return await this.invoke_tool(invocation, bearerToken, context);
    } catch (err){
        if(err instanceof CallToolError){
            throw err;
        }
        throw new CallToolError(err);
    }

  }

  make_context(input, parentContext){
    // - build the sub-context with:
    //   - $trigger seeded from the resolved input (after interpolation)
    //   - $accountability passed through unchanged from the parent context
      //  - $env copied from the parent context to allow API calls, but we deep clone it to prevent accidental mutation of the parent context's $env by the sub-tool's flow
      return {
            $trigger: input,
            $vars: this.get_fresh_vars(),
            $accountability: parentContext.$accountability,
            $env: JSON.parse(JSON.stringify(parentContext.$env)),
      }
  }

  // - we trim the output down to just $last and $vars.isError to minimize the data passed back up to the parent flow,
  // and to ensure that any sensitive data in the sub-context is not exposed to the parent flow
  trim_output(o){

      // we have to be careful to guard against an output that is malformed from an unanticipated thrown error
      // if we have $vars.isError explicitly set to false, then we treat this as a non-error state; otherwise we default
      // to true because the unstructured output is indicative of an error we didn't catch and transform
      let is_error = true;
      if(o.$vars && Object.hasOwn(o.$vars,'isError') && ! ( o.$vars.isError )) is_error = false;
      return {
          $last: o.$last || o.message || o,
          $vars:{
              isError: is_error
          }
      };
  }


  async invoke_tool(invocation, bearerToken, context){
    let {name, arguments:args} = invocation;
    // if we have "__" in the name, we can assume that the format is "collation__toolname", otherwise we can treat the
    // whole name as the tool name and look for it in the built in tools
    let tool_collation, tool_name;
    if(name.includes('__')){
        tool_collation = name.split('__')[0];
        tool_name = name.replace(/^[^_]+__/, ''); // remove the collation and separator from the name to get the tool name
    }else{
        tool_collation = null;
        tool_name = name;
    }

    if (args === undefined) {
        args = {};
    }

    let tool;
    if(!tool_collation || tool_collation === ''){
        tool = DEFAULT_TOOLS.find(t => t.name === tool_name);

        if (!tool) throw new CallToolError(`CallTool: tool with name ${tool_name} not found in default tools`);

    }else{
        let tools = await fetchToolsForCollation(context.$env.DIRECTUS_BASE_URL, bearerToken, tool_collation);
        tool = tools.find(t => t.name === tool_name);

        if ( !tool) throw new CallToolError(`CallTool: tool with name ${tool_name} not found in collation ${tool_collation}`);

    }

    // compile the validation inputSchema and test against the invocation.arguments;
    // if validation fails, throw an error to prevent executing the sub-tool with invalid input
    if (tool?.inputSchema) {
        let {isValid, errors} = validate_arguments(tool.inputSchema, args, tool.name);
        if (!isValid) {
            // keep the same error format as the validation function for consistency, and to allow the parent flow to handle it if needed
            throw new CallToolError(`argument validation failed for tool ${tool.name} with errors: ${JSON.stringify(errors)}`);
        }
    }


    // Execute the sub-tool's flow,
    // - Pass bearerToken through explicitly so that injection without exposure still works
    // run_operations(operations, start_slug, initialContext = {}, bearerToken = null)
    let subContext = await this.run_operations(tool.operations, tool.start_slug, this.make_context(args, context), bearerToken);

    // make sure that we trigger the reject path if the sub-tool ended in an error state,
    // so that the parent tool can handle it if needed
    if (subContext.$vars.isError) {
      throw this.trim_output(subContext);
    }

    return this.trim_output(subContext)
  }

    async invoke_tool_list(invocation_list, bearerToken, iteration_mode, context) {
        let results = [];

        if (iteration_mode === 'parallel') {
            const promises = invocation_list.map(invocation =>
                this.invoke_tool(invocation, bearerToken, context)
            );

            const settled = await Promise.allSettled(promises);

            results = settled.map(r =>
                r.status === 'fulfilled'
                    ? this.trim_output(r.value)
                    : this.trim_output(r.reason)
            );

            if(results.every(r => r.$vars.isError)){
                throw results;
            }

        } else {
            for (let invocation of invocation_list) {
                const result = await this.invoke_tool(invocation, bearerToken, context);
                if(result.$vars.isError){
                    throw this.trim_output(result)
                }
                results.push(this.trim_output(result));
            }
        }

        return results;
    }

}

class CallToolError extends Error {
    constructor(message) {
        // Extract a human-readable string for Error.message when message is an
        // object (e.g. a trim_output result with $last containing the actual error).
        let msg;
        if (message instanceof Error) {
            msg = message.message;
        } else if (message && typeof message === 'object') {
            const last = message.$last;
            msg = last instanceof Error ? last.message
                : typeof last === 'string' ? last
                : JSON.stringify(last);
        } else {
            msg = String(message);
        }
        super(msg);
        this.$last = message;
        this.$vars = {isError: true};
    }
}
