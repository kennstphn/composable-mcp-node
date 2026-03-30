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

import Mustache from 'mustache';

// Disable HTML escaping — this is an HTTP API context, not HTML generation.
Mustache.escape = (text) => text;

/**
 * Render a Mustache `template` string against `context`.
 * When the entire template is a single `{{key}}` placeholder the raw context
 * value is returned as-is (preserving objects/arrays/numbers).
 */
function interpolate(template, context) {
  if (typeof template !== 'string') return template;

  const exact = /^\{\{\s*(\$?[\w.]+)\s*\}\}$/.exec(template);
  if (exact) {
    const value = exact[1].split('.').reduce((obj, k) => obj?.[k], context);
    return value !== undefined ? value : '';
  }

  return Mustache.render(template, context);
}

/**
 * Recursively render all string leaves in a value.
 */
function interpolateValue(value, context) {
  if (typeof value === 'string') return interpolate(value, context);
  if (Array.isArray(value)) return value.map(item => interpolateValue(item, context));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateValue(v, context);
    }
    return out;
  }
  return value;
}

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

  async run(context) {
    const { tool_collation, tool_slug, input } = this.config;

    if (!tool_collation) {
      throw new Error("CallTool: 'tool_collation' property is required in config");
    }
    if (!tool_slug) {
      throw new Error("CallTool: 'tool_slug' property is required in config");
    }

    const bearerToken = context?.$env?.DIRECTUS_TOKEN;
    const baseUrl = context?.$env?.DIRECTUS_BASE_URL;

    if (!bearerToken) {
      throw new Error("CallTool: DIRECTUS_TOKEN is not available in context.$env");
    }
    if (!baseUrl) {
      throw new Error("CallTool: DIRECTUS_BASE_URL is not available in context.$env");
    }

    // Resolve input values against the current context before passing them to the sub-tool
    const resolvedInput = input !== undefined ? interpolateValue(input, context) : {};

    // Fetch the target tool definition from Directus
    const url = new URL('/items/tools', baseUrl);
    url.searchParams.set('fields', '*,operations.*');
    url.searchParams.set('filter[tool_collation][_eq]', tool_collation);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      const err = new Error(`CallTool: Directus authorization failed (HTTP ${response.status})`);
      err.status = response.status;
      throw err;
    }

    if (!response.ok) {
      throw new Error(`CallTool: Directus returned HTTP ${response.status}`);
    }

    const { data } = await response.json();
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
    });

    if (subContext.$error) {
      throw subContext.$error;
    }

    if (subContext.$last instanceof Error) {
      throw subContext.$last;
    }

    return subContext.$last;
  }
}
