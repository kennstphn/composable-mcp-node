const DESCRIPTION_JAVASCRIPT_CODE = `JavaScript code. Runs in a sandboxed VM (no console, fetch, fs, process, Buffer, DOM globals, or external libs. Plain JS + async/await + data params only).

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

/**
 * Default tool definitions — served directly from the filesystem at POST /mcp.
 *
 * These eleven tools let an authenticated user manage tool definitions inside
 * Directus through the MCP interface.  They are NOT stored in Directus; the
 * server loads them from this module and executes them locally.
 *
 *
 */

// ─── list_operation_types ─────────────────────────────────────────────────────

export const LIST_OPERATION_TYPES_TOOL = {
  name: 'list_operation_types',
  title: 'List Operation Types',
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
  name: 'create_tool',
  title: 'Create Tool',
  description: 'Creates a new tool definition in Directus.',
  inputSchema: {
    type: 'object',
    properties: {
      name:            { type: 'string', description: 'Unique identifier for the tool' },
      title:            { type: 'string', description: 'Human-readable display name' },
      description:     { type: 'string', description: 'What the tool does' },
      tool_collation:  { type: 'string', description: 'Collation (namespace) this tool belongs to' },
      inputSchema:     { type: 'object', description: 'JSON Schema for the tool inputs' },
      start_slug:      { type: 'string', description: 'Slug of the first operation to run' },
    },
    required: ['title', 'name', 'tool_collation', 'start_slug'],
  },
  start_slug: 'transform_input_schema',
  operations: [
    {
      slug: 'transform_input_schema',
      type: 'run_script',
      config: {
        code: "module.exports = async function(data) { let i=data.$trigger.inputSchema; return typeof i === 'object' ? JSON.stringify(i) : null; };",
      },
      resolve: 'post_tool',
      reject: null,
    },
    {
      slug: 'post_tool',
      type: 'fetch_request',
      config: {
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          title:           '{{$trigger.title}}',
          name:           '{{$trigger.name}}',
          description:    '{{$trigger.description}}',
          tool_collation: '{{$trigger.tool_collation}}',
          inputSchema:    '{{$last}}',
          start_slug:     '{{$trigger.start_slug}}',
        },
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── add_run_script_operation ─────────────────────────────────────────────────

export const ADD_RUN_SCRIPT_OPERATION_TOOL = {
  name: 'add_run_script_operation',
  title: 'Add Run Script Operation',
  description: 'Adds a run_script operation step to an existing tool.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_id:  { type: 'integer', description: 'ID of the parent tool' },
      slug:     { type: 'string',  description: 'Unique slug for this operation within the tool' },
      code:     { type: 'string',  description: DESCRIPTION_JAVASCRIPT_CODE},
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/operations',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          tool:    '{{$trigger.tool_id}}',
          slug:    '{{$trigger.slug}}',
          type:    'run_script',
          config:  { code: '{{$trigger.code}}' },
          resolve: '{{$trigger.resolve}}',
          reject:  '{{$trigger.reject}}',
        },
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── add_fetch_request_operation ──────────────────────────────────────────────

export const ADD_FETCH_REQUEST_OPERATION_TOOL = {
  name: 'add_fetch_request_operation',
  title: 'Add Fetch Request Operation',
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
          '  const config = { url: data.$trigger.url };',
          '  if (data.$trigger.method  !== undefined) config.method  = data.$trigger.method;',
          '  if (data.$trigger.headers !== undefined) config.headers = data.$trigger.headers;',
          '  if (data.$trigger.body    !== undefined) config.body    = data.$trigger.body;',
          '  return {',
          '    tool:    data.$trigger.tool_id,',
          '    slug:    data.$trigger.slug,',
          '    type:    "fetch_request",',
          '    config,',
          '    resolve: data.$trigger.resolve ?? null,',
          '    reject:  data.$trigger.reject  ?? null,',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/operations',
        method: 'POST',
        headers: {
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
  name: 'edit_tool',
  title: 'Edit Tool',
  description: 'Updates fields on an existing tool.  Only supplied fields are changed.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_id:       { type: 'integer', description: 'ID of the tool to update' },
      name:          { type: 'string' },
      title:          { type: 'string' },
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
`
module.exports = async function(data) {
    const patch = {};
    for(let field of ["name", "title", "description", "tool_collation", "start_slug", "inputSchema"]) {
    let v = data.$trigger[field];
        if( v !== undefined) {
            patch[field] = field === "inputSchema" && typeof v === 'object' ? JSON.stringify(v) : v;
        }
    }
    return patch;
}
    
`
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools/{{$trigger.tool_id}}',
        method: 'PATCH',
        headers: {
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
  name: 'edit_run_script_operation',
  title: 'Edit Run Script Operation',
  description: 'Updates a run_script operation step.  Only supplied fields are changed.',
  inputSchema: {
    type: 'object',
    properties: {
      operation_id: { type: 'integer', description: 'ID of the operation to update' },
      slug:         { type: 'string',  description: 'New slug for this operation' },
      code:         { type: 'string',  description: DESCRIPTION_JAVASCRIPT_CODE },
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
          '  if (data.$trigger.slug    !== undefined) patch.slug    = data.$trigger.slug;',
          '  if (data.$trigger.resolve !== undefined) patch.resolve = data.$trigger.resolve;',
          '  if (data.$trigger.reject  !== undefined) patch.reject  = data.$trigger.reject;',
          '  if (data.$trigger.code    !== undefined) patch.config  = { code: data.$trigger.code };',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/operations/{{$trigger.operation_id}}',
        method: 'PATCH',
        headers: {
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
  name: 'edit_fetch_request_operation',
  title: 'Edit Fetch Request Operation',
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
          '  if (data.$trigger.slug    !== undefined) patch.slug    = data.$trigger.slug;',
          '  if (data.$trigger.resolve !== undefined) patch.resolve = data.$trigger.resolve;',
          '  if (data.$trigger.reject  !== undefined) patch.reject  = data.$trigger.reject;',
          '  const configFields = ["url", "method", "headers", "body"];',
          '  const config = {};',
          '  for (const f of configFields) {',
          '    if (data.$trigger[f] !== undefined) config[f] = data.$trigger[f];',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/operations/{{$trigger.operation_id}}',
        method: 'PATCH',
        headers: {
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
  name: 'list_collations',
  title: 'List Collations',
  description: 'Returns the distinct collation names (namespaces) that have tools stored in Directus.',
  inputSchema: { type: 'object', properties: {} },
  start_slug: 'fetch_collations',
  operations: [
    {
      slug: 'fetch_collations',
      type: 'fetch_request',
      config: {
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools?groupBy[]=tool_collation&fields=tool_collation',
        method: 'GET',
        headers: {
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
  name: 'list_composed_tools',
  title: 'List Composed Tools',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools?filter[tool_collation][_eq]={{$trigger.tool_collation}}&fields=id,title,name,description,tool_collation,inputSchema',
        method: 'GET',
        headers: {
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
  name: 'test_composed_tool',
  title: 'Test Composed Tool',
  description: 'Fetches a tool stored in Directus and executes it with the supplied arguments.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_collation: { type: 'string', description: 'The collation (namespace) the tool belongs to' },
      tool_name:      { type: 'string', description: 'The name of the tool to run' },
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
  name: 'delete_composed_tool',
  title: 'Delete Composed Tool',
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
          '  if (data.$trigger.confirm !== true) {',
          '    throw new Error("Deletion not confirmed. Call this tool again with confirm: true to permanently delete tool " + data.$trigger.tool_id + ".");',
          '  }',
          '  return data.$trigger.tool_id;',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools/{{$trigger.tool_id}}',
        method: 'DELETE',
        headers: {},
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
