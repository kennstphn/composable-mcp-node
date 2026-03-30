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
 * Runtime requirements (injected into the calling context by App.mjs):
 *   - context.$env.DIRECTUS_BASE_URL — base URL of the Directus instance
 *   - context.$env.DIRECTUS_TOKEN    — bearer token for Directus authentication
 *   - context.$accountability        — accountability object from the calling context;
 *                                      passed through to the sub-tool's flow unchanged
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

    if (!bearerToken) {
      throw new Error("CallTool: DIRECTUS_TOKEN is not available in context.$env");
    }
    if (!baseUrl) {
      throw new Error("CallTool: DIRECTUS_BASE_URL is not available in context.$env");
    }

    // Resolve input values against the current context before passing them to the sub-tool
    const resolvedInput = input !== undefined ? interpolateValue(input, context) : {};

    // Fetch tools for the specified collation (and slug, to minimize data transfer)
    let data = fetchToolsForCollation(context.$env.DIRECTUS_BASE_URL, bearerToken, tool_collation, tool_slug);
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

    // Directus tools may use either `slug` (preferred) or `name` as the identifier —
    // match whichever is present, consistent with the rest of the codebase.
    const tool = tools.find(t => (t.slug || t.name) === tool_slug);
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
    }, bearerToken);

    return subContext.$last;
  }
}
