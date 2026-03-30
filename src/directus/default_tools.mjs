/**
 * Default tool definitions — served directly from the filesystem at POST /mcp.
 *
 * These seven tools let an authenticated user manage tool definitions inside
 * Directus through the MCP interface.  They are NOT stored in Directus; the
 * server loads them from this module and executes them locally.
 *
 * When a default tool is executed the server injects two top-level context keys
 * that fetch_request operations can use via template interpolation:
 *
 *   • `DIRECTUS_BASE_URL` — the server's configured Directus instance URL
 *   • `DIRECTUS_TOKEN`    — the caller's bearer token (from the Authorization header)
 *
 * These keys are intentionally NOT placed in `$env` so they are unavailable to
 * run_script operations, which keeps credentials out of user-visible code paths.
 */

// ─── list_operation_types ─────────────────────────────────────────────────────

export const LIST_OPERATION_TYPES_TOOL = {
  slug: 'list_operation_types',
  name: 'List Operation Types',
  description: 'Returns the operation types supported by this server.',
  inputSchema: { type: 'object', properties: {} },
  start_slug: 'return_types',
  operations: [
    {
      slug: 'return_types',
      type: 'run_script',
      config: {
        code: 'module.exports = async function() { return ["run_script", "fetch_request", "call_tool"]; };',
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── create_tool ──────────────────────────────────────────────────────────────

export const CREATE_TOOL_TOOL = {
  slug: 'create_tool',
  name: 'Create Tool',
  description: 'Creates a new tool definition in Directus.',
  inputSchema: {
    type: 'object',
    properties: {
      slug:            { type: 'string', description: 'Unique identifier for the tool' },
      name:            { type: 'string', description: 'Human-readable display name' },
      description:     { type: 'string', description: 'What the tool does' },
      tool_collation:  { type: 'string', description: 'Collation (namespace) this tool belongs to' },
      inputSchema:     { type: 'object', description: 'JSON Schema for the tool inputs' },
      start_slug:      { type: 'string', description: 'Slug of the first operation to run' },
    },
    required: ['slug', 'name', 'tool_collation', 'start_slug'],
  },
  start_slug: 'post_tool',
  operations: [
    {
      slug: 'post_tool',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/tools',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: {
          slug:           '{{slug}}',
          name:           '{{name}}',
          description:    '{{description}}',
          tool_collation: '{{tool_collation}}',
          inputSchema:    '{{inputSchema}}',
          start_slug:     '{{start_slug}}',
        },
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── add_run_script_operation ─────────────────────────────────────────────────

export const ADD_RUN_SCRIPT_OPERATION_TOOL = {
  slug: 'add_run_script_operation',
  name: 'Add Run Script Operation',
  description: 'Adds a run_script operation step to an existing tool.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_id:  { type: 'integer', description: 'ID of the parent tool' },
      slug:     { type: 'string',  description: 'Unique slug for this operation within the tool' },
      code:     { type: 'string',
        description: `JavaScript code. Runs in a sandboxed VM (no console, fetch, fs, process, Buffer, DOM globals, or external libs. Plain JS + async/await + data params only).

module.exports = async function(data) {
  /* const {
       $trigger,        // immutable original input (e.g., { name: 'foo' })
       $accountability, // user context
       $last,           // immediate prior op output
       a_previous_slug, // return from some prior op with slug "a_previous_slug"
       // ...any prior operation by its slug
     } = data;
  // Return plain object (or array/string). Value stored in data[this.slug] and next op's $last. */
}`
      },
      resolve:  { type: 'string',  description: 'Slug of next operation on success (omit to stop)' },
      reject:   { type: 'string',  description: 'Slug of next operation on error (omit to stop)' },
    },
    required: ['tool_id', 'slug', 'code'],
  },
  start_slug: 'post_operation',
  operations: [
    {
      slug: 'post_operation',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/operations',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: {
          tool:    '{{tool_id}}',
          slug:    '{{slug}}',
          type:    'run_script',
          config:  { code: '{{code}}' },
          resolve: '{{resolve}}',
          reject:  '{{reject}}',
        },
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── add_fetch_request_operation ──────────────────────────────────────────────

export const ADD_FETCH_REQUEST_OPERATION_TOOL = {
  slug: 'add_fetch_request_operation',
  name: 'Add Fetch Request Operation',
  description: 'Adds a fetch_request operation step to an existing tool.',
  inputSchema: {
    type: 'object',
    description: "Simple interpolation is supported via {{ $accountability.some_field }}, {{ $last }}, {{ $trigger.input_field_name }} or {{ a_previous_slug.prop_one }} referencing any prior step by slug. \n" +
        "Complex objects (like body, or dynamic headers, etc) can be built in a preceding run_script operation that returns the assembled object, then referenced here via {{ $last }} or {{ a_previous_slug.some_prop }}.",
    properties: {
      tool_id:  { type: 'integer', description: 'ID of the parent tool' },
      slug:     { type: 'string',  description: 'Unique slug for this operation within the tool' },
      url:      { type: 'string',  description: 'URL to fetch (supports {{template}} interpolation)' },
      method:   { type: 'string',  enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method (default: GET)' },
      headers:  { type: 'object',  description: 'HTTP headers as key-value pairs' },
      body:     { description: 'Request body (object or string)' },
      resolve:  { type: 'string',  description: 'Slug of next operation on success (omit to stop)' },
      reject:   { type: 'string',  description: 'Slug of next operation on error (omit to stop)' },
    },
    required: ['tool_id', 'slug', 'url'],
  },
  start_slug: 'build_body',
  operations: [
    {
      // Step 1: assemble the operation document, keeping optional config fields
      // out when they were not provided by the caller
      slug: 'build_body',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  const config = { url: data.url };',
          '  if (data.method  !== undefined) config.method  = data.method;',
          '  if (data.headers !== undefined) config.headers = data.headers;',
          '  if (data.body    !== undefined) config.body    = data.body;',
          '  return {',
          '    tool:    data.tool_id,',
          '    slug:    data.slug,',
          '    type:    "fetch_request",',
          '    config,',
          '    resolve: data.resolve ?? null,',
          '    reject:  data.reject  ?? null,',
          '  };',
          '};',
        ].join('\n'),
      },
      resolve: 'post_operation',
      reject: null,
    },
    {
      // Step 2: POST the assembled document to Directus
      slug: 'post_operation',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/operations',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: '{{$last}}',
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── edit_tool ────────────────────────────────────────────────────────────────

export const EDIT_TOOL_TOOL = {
  slug: 'edit_tool',
  name: 'Edit Tool',
  description: 'Updates fields on an existing tool.  Only supplied fields are changed.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_id:       { type: 'integer', description: 'ID of the tool to update' },
      slug:          { type: 'string' },
      name:          { type: 'string' },
      description:   { type: 'string' },
      tool_collation:{ type: 'string' },
      inputSchema:   { type: 'object' },
      start_slug:    { type: 'string' },
    },
    required: ['tool_id'],
  },
  start_slug: 'build_patch',
  operations: [
    {
      // Step 1: build a patch object containing only the provided fields
      slug: 'build_patch',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  // Mutable fields of the tools collection (mirrors TOOLS_SCHEMA in schema.mjs)',
          '  const fields = ["slug","name","description","tool_collation","inputSchema","start_slug"];',
          '  const patch = {};',
          '  for (const f of fields) {',
          '    if (data[f] !== undefined) patch[f] = data[f];',
          '  }',
          '  return patch;',
          '};',
        ].join('\n'),
      },
      resolve: 'patch_tool',
      reject: null,
    },
    {
      // Step 2: PATCH the tool with the built object ($last)
      slug: 'patch_tool',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/tools/{{tool_id}}',
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: '{{$last}}',
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── edit_run_script_operation ────────────────────────────────────────────────

export const EDIT_RUN_SCRIPT_OPERATION_TOOL = {
  slug: 'edit_run_script_operation',
  name: 'Edit Run Script Operation',
  description: 'Updates a run_script operation step.  Only supplied fields are changed.',
  inputSchema: {
    type: 'object',
    properties: {
      operation_id: { type: 'integer', description: 'ID of the operation to update' },
      slug:         { type: 'string',  description: 'New slug for this operation' },
      code:         { type: 'string',  description: 'New JavaScript code for the script' },
      resolve:      { type: 'string',  description: 'Slug of next operation on success (omit to keep current)' },
      reject:       { type: 'string',  description: 'Slug of next operation on error (omit to keep current)' },
    },
    required: ['operation_id'],
  },
  start_slug: 'build_patch',
  operations: [
    {
      // Step 1: build a patch object containing only the provided fields
      slug: 'build_patch',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  const patch = {};',
          '  if (data.slug    !== undefined) patch.slug    = data.slug;',
          '  if (data.resolve !== undefined) patch.resolve = data.resolve;',
          '  if (data.reject  !== undefined) patch.reject  = data.reject;',
          '  if (data.code    !== undefined) patch.config  = { code: data.code };',
          '  return patch;',
          '};',
        ].join('\n'),
      },
      resolve: 'patch_operation',
      reject: null,
    },
    {
      // Step 2: PATCH the operation with the built object ($last)
      slug: 'patch_operation',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/operations/{{operation_id}}',
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: '{{$last}}',
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── edit_fetch_request_operation ─────────────────────────────────────────────

export const EDIT_FETCH_REQUEST_OPERATION_TOOL = {
  slug: 'edit_fetch_request_operation',
  name: 'Edit Fetch Request Operation',
  description: 'Updates a fetch_request operation step.  Only supplied fields are changed.',
  inputSchema: {
    type: 'object',
    properties: {
      operation_id: { type: 'integer', description: 'ID of the operation to update' },
      slug:         { type: 'string',  description: 'New slug for this operation' },
      url:          { type: 'string',  description: 'New URL to fetch' },
      method:       { type: 'string',  enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'New HTTP method' },
      headers:      { type: 'object',  description: 'New HTTP headers as key-value pairs' },
      body:         { description: 'New request body (object or string)' },
      resolve:      { type: 'string',  description: 'Slug of next operation on success (omit to keep current)' },
      reject:       { type: 'string',  description: 'Slug of next operation on error (omit to keep current)' },
    },
    required: ['operation_id'],
  },
  start_slug: 'build_patch',
  operations: [
    {
      // Step 1: build a patch object containing only the provided fields;
      // config sub-fields (url, method, headers, body) are merged into a
      // single config object so partial updates work correctly
      slug: 'build_patch',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  const patch = {};',
          '  if (data.slug    !== undefined) patch.slug    = data.slug;',
          '  if (data.resolve !== undefined) patch.resolve = data.resolve;',
          '  if (data.reject  !== undefined) patch.reject  = data.reject;',
          '  const configFields = ["url", "method", "headers", "body"];',
          '  const config = {};',
          '  for (const f of configFields) {',
          '    if (data[f] !== undefined) config[f] = data[f];',
          '  }',
          '  if (Object.keys(config).length > 0) patch.config = config;',
          '  return patch;',
          '};',
        ].join('\n'),
      },
      resolve: 'patch_operation',
      reject: null,
    },
    {
      // Step 2: PATCH the operation with the built object ($last)
      slug: 'patch_operation',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/operations/{{operation_id}}',
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: '{{$last}}',
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── list_collations ──────────────────────────────────────────────────────────

export const LIST_COLLATIONS_TOOL = {
  slug: 'list_collations',
  name: 'List Collations',
  description: 'Returns the distinct collation names (namespaces) that have tools stored in Directus.',
  inputSchema: { type: 'object', properties: {} },
  start_slug: 'fetch_collations',
  operations: [
    {
      slug: 'fetch_collations',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/tools?groupBy[]=tool_collation&fields=tool_collation',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
      },
      resolve: 'extract_names',
      reject: null,
    },
    {
      // Directus returns { data: [{ tool_collation: "pco" }, ...] }
      // — unwrap to a plain array of name strings.
      slug: 'extract_names',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  const rows = (data.fetch_collations && data.fetch_collations.data) || [];',
          '  return rows.map(function(r) { return r.tool_collation; }).filter(Boolean);',
          '};',
        ].join('\n'),
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── list_composed_tools ──────────────────────────────────────────────────────

export const LIST_COMPOSED_TOOLS_TOOL = {
  slug: 'list_composed_tools',
  name: 'List Composed Tools',
  description: 'Returns the tools stored in Directus for the specified collation.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_collation: { type: 'string', description: 'The collation (namespace) to list tools for' },
    },
    required: ['tool_collation'],
  },
  start_slug: 'fetch_tools',
  operations: [
    {
      slug: 'fetch_tools',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/tools?filter[tool_collation][_eq]={{tool_collation}}&fields=id,slug,name,description,tool_collation,inputSchema',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── test_composed_tool ────────────────────────────────────────────────────────
// NOTE: this tool is intercepted and handled directly in App.mjs before the
// normal executeFlow path.  The single stub operation below is never executed;
// it exists only so that tools/list can return a proper tool descriptor.

export const TEST_COMPOSED_TOOL_TOOL = {
  slug: 'test_composed_tool',
  name: 'Test Composed Tool',
  description: 'Fetches a tool stored in Directus and executes it with the supplied arguments.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_collation: { type: 'string', description: 'The collation (namespace) the tool belongs to' },
      tool_name:      { type: 'string', description: 'The slug of the tool to run' },
      arguments:      { type: 'object', description: 'Input arguments to pass to the tool', additionalProperties: true },
    },
    required: ['tool_collation', 'tool_name'],
  },
  start_slug: 'run',
  operations: [
    {
      // Stub — test_composed_tool is handled specially in App.mjs before this is reached.
      slug: 'run',
      type: 'run_script',
      config: { code: 'module.exports = async function() { return null; };' },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── delete_composed_tool ─────────────────────────────────────────────────────

export const DELETE_COMPOSED_TOOL_TOOL = {
  slug: 'delete_composed_tool',
  name: 'Delete Composed Tool',
  description: 'Permanently deletes a tool from Directus. Requires explicit confirmation via the confirm field.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_id: { type: 'integer', description: 'The numeric ID of the tool to delete' },
      confirm: { type: 'boolean', description: 'Must be true to confirm permanent deletion' },
    },
    required: ['tool_id', 'confirm'],
  },
  start_slug: 'check_confirmation',
  operations: [
    {
      // Guard: throw (and stop) when the caller has not confirmed the deletion.
      slug: 'check_confirmation',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  if (data.confirm !== true) {',
          '    throw new Error("Deletion not confirmed. Call this tool again with confirm: true to permanently delete tool " + data.tool_id + ".");',
          '  }',
          '  return data.tool_id;',
          '};',
        ].join('\n'),
      },
      resolve: 'delete_tool',
      reject: null,
    },
    {
      slug: 'delete_tool',
      type: 'fetch_request',
      config: {
        url: '{{DIRECTUS_BASE_URL}}/items/tools/{{tool_id}}',
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer {{DIRECTUS_TOKEN}}',
        },
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── All default tools ────────────────────────────────────────────────────────

export const DEFAULT_TOOLS = [
  LIST_OPERATION_TYPES_TOOL,
  CREATE_TOOL_TOOL,
  ADD_RUN_SCRIPT_OPERATION_TOOL,
  ADD_FETCH_REQUEST_OPERATION_TOOL,
  EDIT_TOOL_TOOL,
  EDIT_RUN_SCRIPT_OPERATION_TOOL,
  EDIT_FETCH_REQUEST_OPERATION_TOOL,
  LIST_COLLATIONS_TOOL,
  LIST_COMPOSED_TOOLS_TOOL,
  TEST_COMPOSED_TOOL_TOOL,
  DELETE_COMPOSED_TOOL_TOOL,
];
