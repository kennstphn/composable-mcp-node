import {interpolateValue} from "../functions/interpolateValue.mjs";
import {fetchToolsForCollation} from "../functions/get_tools_with_operations.mjs";

/**
 * CallTool operation — calls another Directus-backed tool from within a flow.
 *
 * Config schema:
 * {
 *   "tool_collation": string  (required) — the tool collation to look up the target tool in,
 *   "tool_name":      string  (required) — name of the target tool to call,
 *   "iteration_mode": string  (optional) — if tool_arguments is an array, determines whether to call the sub-tool in 'parallel' or 'serial' for each item in the array; defaults to 'serial'
 *   "tool_arguments":          object-array|object  (optional) — arguments to pass to the target tool; supports
 *                             Mustache interpolation against the calling flow's context
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

    let { tool_collation, tool_name, tool_arguments,iteration_mode } = this.config;

    // dependency injection of run_operations and get_fresh_vars from the parent flow,
    // to allow the CallTool to execute the sub-tool's operations and to create a fresh $vars object for the sub-context
    let {run_operations,get_fresh_vars} = this;

    if (!tool_collation) {
      throw new Error("CallTool: 'tool_collation' property is required in config");
    }
    if (!tool_name) {
      throw new Error("CallTool: 'tool_name' property is required in config");
    }
    if (! iteration_mode){
        iteration_mode = 'serial';
    }
    if(! tool_arguments){
        tool_arguments = {};
    }

    const baseUrl = context?.$env?.DIRECTUS_BASE_URL;

    if (!baseUrl) {
      throw new Error("CallTool: DIRECTUS_BASE_URL is not available in context.$env");
    }

    // Interpolate config values against the current context, to allow dynamic resolution of the target tool and
    // arguments based on the calling flow's state
    tool_collation = interpolateValue(tool_collation, context);
    tool_name = interpolateValue(tool_name, context);
    iteration_mode = interpolateValue(iteration_mode, context);

    // Resolve argument values against the current context before passing them to the sub-tool
    const resolvedInput = tool_arguments !== undefined ? interpolateValue(tool_arguments, context) : {};

    // Fetch tools for the specified collation, filtered by tool_name (= the tool name) to minimize data transfer
    const data = await fetchToolsForCollation(context.$env.DIRECTUS_BASE_URL, bearerToken, tool_collation, tool_name);
    const tools = data || [];

    // Parse inputSchema strings if needed
    for (const tool of tools) {
      if (tool.inputSchema && typeof tool.inputSchema === 'string') {
        try {
          tool.inputSchema = JSON.parse(tool.inputSchema);
        } catch (e) {
          tool.inputSchema = { type: 'object', properties: {} };
        }
      }
    }

    // Tools are identified by their `name` field — `tool_name` in the config is the tool's name/identifier.
    const tool = tools.find(t => t.name === tool_name);
    if (!tool) {
      throw new Error(`CallTool: tool "${tool_name}" not found in collation "${tool_collation}"`);
    }


    // - build the sub-context with:
    //   - $trigger seeded from the resolved input (after interpolation)
    //   - $accountability and $env passed through unchanged from the parent context
    let make_context = (input) => ({
        $trigger: input,
        $vars: get_fresh_vars(),
        $accountability: context.$accountability,
        $env: context.$env,
    });


    let subContext;
    // the simplest use case is that the subContext is not an array...
    if ( ! Array.isArray(resolvedInput)) {
        // Execute the sub-tool's flow,
        // - Pass bearerToken through explicitly so that injection without exposure still works
        subContext = await run_operations(tool.operations, tool.start_slug, make_context(resolvedInput), bearerToken);

        // make sure that we trigger the reject path if the sub-tool ended in an error state,
        // so that the parent tool can handle it if needed
        if (subContext.$vars.isError) {
          throw this.trim_output(subContext);
        }

        return this.trim_output(subContext);
    }else{
      let results;
      if(iteration_mode === 'parallel'){
        results = await this.invoke_array_parallel(tool, resolvedInput.map( input => make_context(input)), bearerToken);
      }else{
        results = await this.invoke_array_serial(tool, resolvedInput.map( input => make_context(input)), bearerToken);
      }
      // only throw when ALL iterations fail.
      if(results.every(r => r.$vars.isError)){
          throw results;
      }
      return results;

    }

  }

  // - we trim the output down to just $last and $vars.isError to minimize the data passed back up to the parent flow,
  // and to ensure that any sensitive data in the sub-context is not exposed to the parent flow
  trim_output(o){
    return {
        $last: o.$last,
        $vars:{isError: o.$vars.isError}
    }
  }

  /**
   * Invoke the sub-tool for each item in the context_array in series, and return an array of results.
   * The results are trimmed down to just $last and $vars.isError for each item, to minimize data passed back up to the
   * parent flow and to avoid exposing sensitive data.
   * @param tool
   * @param context_array
   * @param bearerToken
   * @returns {Promise<*[]>}
   */
  async invoke_array_serial(tool,context_array,bearerToken){
    let results = [];
    for(let context of context_array){
        let result = await this.run_operations(tool.operations, tool.start_slug, context, bearerToken);
        results.push(this.trim_output(result));
    }
    return results;
  }

  /**
   * Invoke the sub-tool for each item in the context_array in parallel, and return an array of results.
   * The results are trimmed down to just $last and $vars.isError for each item, to minimize data passed back up to the
   * parent flow and to avoid exposing sensitive data.
   *
   * @param tool
   * @param context_array
   * @param bearerToken
   * @returns {Promise<{$last: *, $vars: {isError: *}}[]>}
   */
  async invoke_array_parallel(tool,context_array,bearerToken){
    let promises = context_array.map(context => this.run_operations(tool.operations, tool.start_slug, context, bearerToken));
    let results = await Promise.all(promises);
    return results.map( o => this.trim_output(o));
  }

}
