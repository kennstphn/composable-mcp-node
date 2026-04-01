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

    let { invocation, iteration_mode } = this.config;

    // dependency injection of run_operations and get_fresh_vars from the parent flow,
    // to allow the CallTool to execute the sub-tool's operations and to create a fresh $vars object for the sub-context
    let {run_operations,get_fresh_vars} = this;


    if (! iteration_mode){
        iteration_mode = 'serial';
    }


    const baseUrl = context?.$env?.DIRECTUS_BASE_URL;

    if (!baseUrl) {
      throw new Error("CallTool: DIRECTUS_BASE_URL is not available in context.$env");
    }

    // Interpolate config values against the current context, to allow dynamic resolution of the target tool and
    // arguments based on the calling flow's state
    invocation = interpolateValue(invocation, context);
    iteration_mode = interpolateValue(iteration_mode, context);



    // - build the sub-context with:
    //   - $trigger seeded from the resolved input (after interpolation)
    //   - $accountability and $env passed through unchanged from the parent context
    let make_context = (input) => ({
        $trigger: input,
        $vars: get_fresh_vars(),
        $accountability: context.$accountability,
        $env: context.$env,
    });

    if ( Array.isArray(invocation) ) {
      return await this.invoke_tool_list(invocation, bearerToken, make_context, iteration_mode);
    }
    return await this.invoke_tool(invocation, bearerToken, make_context);

  }

  // - we trim the output down to just $last and $vars.isError to minimize the data passed back up to the parent flow,
  // and to ensure that any sensitive data in the sub-context is not exposed to the parent flow
  trim_output(o){
    return {
        $last: o.$last,
        $vars:{isError: o.$vars.isError}
    }
  }


  async invoke_tool(invocation, bearerToken, make_context){
    let {tool_collation, tool_name, arguments:args} = invocation;
    if (!tool_collation || !tool_name) {
        throw new Error("CallTool: invocation must include tool_collation and tool_name");
    }
    if (args === undefined) {
        args = {};
    }

    // fetch the target tool's details, including its operations and start_slug, to allow us to execute it
    let tool = await fetchToolsForCollation(tool_collation, bearerToken, context.$env.DIRECTUS_BASE_URL)
    let target_tool = tool.find(t => t.name === tool_name);
    if (!target_tool) {
        throw new Error(`CallTool: tool with name ${tool_name} not found in collation ${tool_collation}`);
    }

    // Execute the sub-tool's flow,
    // - Pass bearerToken through explicitly so that injection without exposure still works
    let subContext = await this.run_operations(target_tool.operations, target_tool.start_slug, make_context(args), bearerToken);

    // make sure that we trigger the reject path if the sub-tool ended in an error state,
    // so that the parent tool can handle it if needed
    if (subContext.$vars.isError) {
      throw this.trim_output(subContext);
    }

    return this.trim_output(subContext)
  }

  async invoke_tool_list(invocation_list, bearerToken, make_context, iteration_mode){
    let results = [];
    if(iteration_mode === 'parallel'){
        let promises = invocation_list.map(invocation => this.invoke_tool(invocation, bearerToken, make_context));
        results =  await Promise.all(promises);
    }else{
        for(let invocation of invocation_list){
            let result = await this.invoke_tool(invocation, bearerToken, make_context);
            results.push(this.trim_output(result));
        }
    }

    results = results.map( o => this.trim_output(o));

    if(results.every(r => r.$vars.isError)){
        throw results;
    }
    return results;

  }

}
