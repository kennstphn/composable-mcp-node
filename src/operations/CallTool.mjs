import {interpolateValue} from "../functions/interpolateValue.mjs";
import {fetchToolsForCollation} from "../functions/get_tools_with_operations.mjs";

/**
 * CallTool operation — calls another Directus-backed tool from within a flow.
 *
 * Config schema:
 * {
 *   "tool_collation": string  (required) — the tool collation to look up the target tool in,
 *   "tool_slug":      string  (required) — slug of the target tool to call,
 *   "input":          object  (optional) — arguments to pass to the target tool; supports
 *                             Mustache interpolation against the calling flow's context
 * }
 *
 * Runtime requirements:
 *   - context.$env.DIRECTUS_BASE_URL — base URL of the Directus instance
 *   - context.$env.DIRECTUS_TOKEN    — bearer token for Directus authentication, OR
 *   - bearerToken parameter           — explicitly supplied bearer token (takes precedence)
 *   - context.$accountability         — accountability object from the calling context;
 *                                       passed through to the sub-tool's flow unchanged
 *
 * The operation resolves with the final `$last` value produced by the target tool's flow.
 */


export class CallTool {
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
    const { tool_collation, tool_slug, input } = this.config;

    if (!tool_collation) {
      throw new Error("CallTool: 'tool_collation' property is required in config");
    }
    if (!tool_slug) {
      throw new Error("CallTool: 'tool_slug' property is required in config");
    }

    const baseUrl = context?.$env?.DIRECTUS_BASE_URL;
    // Accept the token from the explicit parameter (runtime path) or fall back to $env
    // (useful when CallTool is driven directly from a test or a script that only has $env).
    const resolvedToken = bearerToken || context?.$env?.DIRECTUS_TOKEN;

    if (!resolvedToken) {
      throw new Error("CallTool: a bearer token is required for Directus authentication");
    }
    if (!baseUrl) {
      throw new Error("CallTool: DIRECTUS_BASE_URL is not available in context.$env");
    }

    // Resolve input values against the current context before passing them to the sub-tool
    const resolvedInput = input !== undefined ? interpolateValue(input, context) : {};

    // Fetch tools for the specified collation, filtered by tool_slug (= the tool name) to minimise data transfer
    const data = await fetchToolsForCollation(context.$env.DIRECTUS_BASE_URL, resolvedToken, tool_collation, tool_slug);
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

    // Tools are identified by their `name` field — `tool_slug` in the config is the tool's name/identifier.
    const tool = tools.find(t => t.name === tool_slug);
    if (!tool) {
      throw new Error(`CallTool: tool "${tool_slug}" not found in collation "${tool_collation}"`);
    }

    // Lazy-import run_operations to avoid a circular module dependency
    // (run_operations imports CallTool; CallTool must not statically import run_operations)
    const { run_operations } = await import('../functions/run_operations.mjs');

    // Execute the sub-tool's flow, injecting accountability from the calling context
    const subContext = await run_operations(tool.operations, tool.start_slug, {
      $trigger: resolvedInput,
      $accountability: context.$accountability,
      $env: context.$env,
    }, resolvedToken);

    // Propagate any unhandled error from the sub-tool's flow (stored in $last when the
    // last operation threw and had no reject chain)
    if (subContext.$last instanceof Error) {
      throw subContext.$last;
    }

    return subContext.$last;
  }
}
