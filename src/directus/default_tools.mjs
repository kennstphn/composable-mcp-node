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

function operation(slug,type,config,resolve=null,reject=null) {
    return {
        slug,
        type,
        config,
        resolve,
        reject
    }
}

const INVOCATION_SCHEMA = {
  type: 'object',
      description: 'The tool call to be run by this operation. NOTE: These values are interpolated against the ' +
  'parent tool\'s execution context at runtime, so you can reference any prior operation or input value ' +
  'in the tool using {{template}} syntax. For complex objects, build the object in a preceding run_script ' +
  'operation and reference it here via {{ $last }} or {{ a_previous_slug.some_prop }}.',
      properties:{
    tool_collation: { type: 'string', description: 'The collation (namespace) the invoked tool belongs to' },
    tool_name:      { type: 'string', description: 'The name of the tool to invoke' },
    iteration_mode: { type: 'string', enum: ['serial', 'parallel'], description: 'Whether to invoke the tool calls in series or in parallel when given an array as input (default: serial)' },
    tool_arguments: { oneOf: [
      { type: 'object' },
      { type: 'array', items: { type: 'object' } }
    ], description: 'Input arguments to pass to the tool. Can be an object or an array of objects for multiple invocations.' },
  },
  required:['tool_collation', 'tool_name']
}

/**
 * Default tool definitions — served directly from the filesystem at POST /mcp.
 *
 * These tools let an authenticated user manage tool definitions inside
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
        slug: 'call_tool',
        type: 'call_tool',
        config: {
            tool_collation: '{{$trigger.tool_collation}}',
            tool_slug: '{{$trigger.tool_name}}',
            tool_arguments: '{{$trigger.arguments}}',
        }
    }
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

export const DELETE_OPERATION_TOOL ={
    name: 'delete_operation',
    title: 'Delete Operation Step',
    description: 'Permanently deletes an operation step from a composed tool. ',
    inputSchema: {
        type: 'object',
        properties: {
            operation_id: { type: 'integer', description: 'The numeric ID of the operation to delete' },
            tool:{
                type:'object',
                description:'The parent tool of the operation, used for an additional safety check to prevent deleting the wrong operation when given a wrong ID.',
                properties:{
                    name: { type: 'string', description: 'The name of the parent tool' },
                    tool_collation: { type: 'string', description: 'The collation of the parent tool' }
                },
                required:['name','tool_collation']
            }
         },
        required: ['operation_id', 'tool'],
    },
    start_slug: 'init',
  operations:[
    // first, get the operation to check if it exists, and to make sure that it's parent tool is the one we expect
    // (avoid deleting the wrong operation when given a wrong ID)
      operation('fetch_operation','fetch_request',{
        url:'{{$env.DIRECTUS_BASE_URL}}/items/operations/{{$trigger.operation_id}}?fields=tool.name,tool.tool_collation',
      },'check_tool',null),

      // check that the operation's parent tool matches the expected tool from the input
        operation('check_tool','run_script',{
          code:`module.exports = async function(data) {
            let {name,tool_collation}       = data.fetch_operation?.data?.tool   || {};
            if(name !== data.$trigger.tool.name || tool_collation !== data.$trigger.tool.tool_collation){
              throw new Error("Operation " + data.$trigger.operation_id + " does not belong to tool " + data.$trigger.tool.name + " in collation " + data.$trigger.tool.tool_collation + ". Aborting deletion.");
            }
            return true;
          }`
        },'delete_operation',null),
      operation('delete_operation','fetch_request',{
        url:'{{$env.DIRECTUS_BASE_URL}}/items/operations/{{$trigger.operation_id}}',
        method:'DELETE',
      },"message_success",null),
      operation('message_success','run_script',{code:"module.exports = () => 'Operation ' + {{$trigger.operation_id}} + ' deleted successfully.';"},null,null)
  ]

}

export const ADD_CALL_TOOL_OPERATION_TOOL = {
    name: 'add_call_tool_operation',
    title: 'Add a Call Tool Operation to a composed tool',
    description: 'Adds a call_tool operation step to an existing tool.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_id:  { type: 'integer', description: 'ID of the parent tool for this operation' },
        slug:     { type: 'string',  description: 'Unique slug for this operation within the tool' },
        invocation: INVOCATION_SCHEMA, // used in add
        resolve:  { type: 'string',  description: 'Slug of next operation on success (omit to stop)' },
        reject:   { type: 'string',  description: 'Slug of next operation on error (omit to stop)' },
      },
      required: ['tool_id', 'slug', 'invocation'],
    },
    start_slug: 'build_body',
    operations:[
        operation('build_body','run_script',{code:`
        module.exports = async function(data) {
          let result = {
              tool:    data.$trigger.tool_id,
              slug:    data.$trigger.slug,
              type:    'call_tool',
              config:  {
                tool_collation: data.$trigger.invocation.tool_collation,
                tool_name: data.$trigger.invocation.tool_name,
              }
          };
          // build the optional config fields only when they are provided, to avoid overwriting existing values with 
          // undefined when editing an existing operation
          if(data.$trigger.invocation.iteration_mode) result.config.iteration_mode = data.$trigger.invocation.iteration_mode;
          if(data.$trigger.invocation.tool_arguments) result.config.tool_arguments = data.$trigger.invocation.tool_arguments;
          if(data.$trigger.resolve) result.resolve = data.$trigger.resolve;
          if(data.$trigger.reject) result.reject = data.$trigger.reject;
          
          return result;
        }
        `},'post_operation',null),
        operation('post_operation','fetch_request',{
          url: '{{$env.DIRECTUS_BASE_URL}}/items/operations',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: '{{build_body}}',
        } )
    ]
}

export const EDIT_CALL_TOOL_OPERATION_TOOL = {
    name: 'edit_call_tool_operation',
    title: 'Edit a Call Tool Operation in a composed tool',
    description: 'Updates a call_tool operation step.  Only supplied fields are changed.',
    inputSchema: {
        type: 'object',
        properties: {
            operation_id: { type: 'integer', description: 'ID of the operation to update' },
            tool_id: { type: 'integer', description: 'ID of the parent tool for this operation (used for safety checks)' },
            slug:         { type: 'string',  description: 'New slug for this operation' },
            invocation: INVOCATION_SCHEMA, // used in edit
            resolve:      { type: 'string',  description: 'Slug of next operation on success (omit to keep current)' },
            reject:       { type: 'string',  description: 'Slug of next operation on error (omit to keep current)' },
        },
        required: ['operation_id', 'tool_id'],
    },
    operations:[
        operation('get_operation','fetch_request',{
            url:'{{$env.DIRECTUS_BASE_URL}}/items/operations/{{$trigger.operation_id}}?fields=tool,id',
        },'validate_tool_id'),
        operation('validate_tool_id','run_script',{code:`
        module.exports = async function(data) {
    let expected_tool_id = data.$trigger.tool_id;
    let actual_tool_id = data.get_operation?.data?.tool;
    if(expected_tool_id !== actual_tool_id) throw new Error("Operation " + data.$trigger.operation_id + " does not belong to tool " + data.$trigger.tool_id + ". Aborting edit.");
    return true;
        }
        `},'build_patch'),
        operation('build_patch','run_script',{code:`
        module.exports = async function(data) {
        let patch = {};
        if(data.$trigger.slug) patch.slug = data.$trigger.slug;
        if(data.$trigger.resolve) patch.resolve = data.$trigger.resolve;
        if(data.$trigger.reject) patch.reject = data.$trigger.reject;
        if(data.$trigger.invocation) {
            patch.config = {};
            if(data.$trigger.invocation.tool_collation) patch.config.tool_collation = data.$trigger.invocation.tool_collation;
            if(data.$trigger.invocation.tool_name) patch.config.tool_name = data.$trigger.invocation.tool_name;
            if(data.$trigger.invocation.iteration_mode) patch.config.iteration_mode = data.$trigger.invocation.iteration_mode;
            if(data.$trigger.invocation.tool_arguments) patch.config.tool_arguments = data.$trigger.invocation.tool_arguments;
            
            // config has to be a json string, so convert it now
            patch.config = JSON.stringify(patch.config);
        }
        
        return patch;
        }
        `},'patch_operation'),
        operation('patch_operation','fetch_request',{
          url: '{{$env.DIRECTUS_BASE_URL}}/items/operations/{{$trigger.operation_id}}',
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: '{{patch_operation}}',
        })
    ]
}

// ─── message_v1_responses ────────────────────────────────────────────────────
//
// Drives an OpenAI Responses-API-compatible tool-calling loop.
// The request accumulator is passed through three run_script stages that chain
// back on themselves until the model stops returning function_call items.

export const MESSAGE_V1_RESPONSES_TOOL = {
  name: 'message_v1_responses',
  title: 'Message v1 Responses',
  description:
    'Sends a request to an OpenAI-compatible Responses API endpoint and drives a ' +
    'tool-calling loop until the model returns a final response.  Each function_call ' +
    'item returned by the model is dispatched to the MCP tool collation supplied by ' +
    'the caller; results are appended to the conversation and the model is called again ' +
    'until no further tool calls are requested.',
  inputSchema: {
    type: 'object',
    properties: {
      request: {
        type: 'object',
        description:
          'Request body sent to the API (e.g. { model, input, tools, … }).  ' +
          'The "input" (or "messages") array is updated automatically with tool ' +
          'results during the loop.',
        properties: {
          model: { type: 'string', description: 'Model identifier (e.g. gpt-4o)' },
        },
        required: ['model'],
      },
      endpoint: {
        type: 'string',
        description: 'API endpoint URL (e.g. https://api.openai.com/v1/responses)',
      },
      token: {
        type: 'string',
        description: 'Bearer token used in the Authorization header',
      },
      tool_collation: {
        type: 'string',
        description:
          'MCP tool collation to use when dispatching tool calls returned by the model. ' +
          'Required when the model is expected to make tool calls.',
      },
    },
    required: ['request', 'endpoint', 'token'],
  },
  start_slug: 'init',
  operations: [
    // ── 1. Seed the request accumulator ─────────────────────────────────────
    operation('init', 'run_script', {
      code: [
        'module.exports = async function(data) {',
        '  return { request: data.$trigger.request };',
        '};',
      ].join('\n'),
    }, 'call_api'),

    // ── 2. POST the current request to the LLM endpoint ─────────────────────
    operation('call_api', 'fetch_request', {
      url: '{{$trigger.endpoint}}',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {{$trigger.token}}',
      },
      // $last is always { request: <object> } – from init on first call,
      // from append_result on subsequent calls.
      body: '{{$last.request}}',
    }, 'extract_calls'),

    // ── 3. Extract tool calls from the response ──────────────────────────────
    // Throws { done, response } (→ finalize) when there are no function_call items.
    // Returns { request, tool_calls } (→ prepare_call) when there are.
    operation('extract_calls', 'run_script', {
      code: [
        'module.exports = async function(data) {',
        '  var response = data.$last;',
        '  // On the first LLM turn append_result has not run yet; use init.request.',
        '  // On subsequent turns use the request that append_result produced.',
        '  var current_request = (data.append_result && data.append_result.request)',
        '    ? data.append_result.request',
        '    : data.init.request;',
        '  var output = response.output || [];',
        '  var tool_calls = output.filter(function(item) {',
        '    return item.type === "function_call";',
        '  });',
        '  if (tool_calls.length === 0) {',
        '    throw { done: true, response: response };',
        '  }',
        '  // Append the assistant output (including the function_call items) to the',
        '  // conversation so the model receives its own turn on the next API call.',
        '  var input_key = "input" in current_request ? "input" : "messages";',
        '  var updated_input = (current_request[input_key] || []).concat(output);',
        '  var updated_request = Object.assign({}, current_request);',
        '  updated_request[input_key] = updated_input;',
        '  return {',
        '    request: updated_request,',
        '    tool_calls: tool_calls.map(function(tc) {',
        '      return {',
        '        call_id: tc.call_id,',
        '        name: tc.name,',
        '        arguments: (function() {',
        '          if (typeof tc.arguments !== "string") return tc.arguments || {};',
        '          try { return JSON.parse(tc.arguments); } catch(e) { return {}; }',
        '        }()),',
        '      };',
        '    }),',
        '  };',
        '};',
      ].join('\n'),
    }, 'prepare_call', 'finalize'),

    // ── 4. Dequeue the next tool call ────────────────────────────────────────
    // $last is either extract_calls result (first visit) or the thrown
    // { request, tool_calls } from append_result (looped visits).
    operation('prepare_call', 'run_script', {
      code: [
        'module.exports = async function(data) {',
        '  var state = data.$last;',
        '  var next_call = state.tool_calls[0];',
        '  var remaining = state.tool_calls.slice(1);',
        '  return {',
        '    request: state.request,',
        '    next_call: next_call,',
        '    remaining: remaining,',
        '  };',
        '};',
      ].join('\n'),
    }, 'invoke_tool'),

    // ── 5. Dispatch the current tool call to the MCP tool collation ──────────
    // context.prepare_call is re-read on every visit so the tool name and
    // arguments always match the currently dequeued call.
    operation('invoke_tool', 'call_tool', {
      tool_collation: '{{$trigger.tool_collation}}',
      tool_name: '{{prepare_call.next_call.name}}',
      tool_arguments: '{{prepare_call.next_call.arguments}}',
      iteration_mode: 'serial',
    }, 'append_result'),

    // ── 6. Append the tool result and decide what to do next ─────────────────
    // Throws { request, tool_calls } (→ prepare_call) when more calls remain.
    // Returns { request } (→ call_api) when all tool calls for this turn are done.
    operation('append_result', 'run_script', {
      code: [
        'module.exports = async function(data) {',
        '  var tool_result = data.$last;',
        '  var state = data.prepare_call;',
        '  // CallTool.trim_output wraps single results as { $last, $vars }.  Unwrap to the',
        '  // plain value; for array results (parallel iteration) unwrap each element.',
        '  var raw = tool_result;',
        '  var result_value = Array.isArray(raw)',
        '    ? raw.map(function(r) { return r && r.$last !== undefined ? r.$last : r; })',
        '    : (raw && raw.$last !== undefined ? raw.$last : raw);',
        '  var tool_output = {',
        '    type: "function_call_output",',
        '    call_id: state.next_call.call_id,',
        '    output: JSON.stringify(result_value),',
        '  };',
        '  var input_key = "input" in state.request ? "input" : "messages";',
        '  var updated_input = (state.request[input_key] || []).concat([tool_output]);',
        '  var updated_request = Object.assign({}, state.request);',
        '  updated_request[input_key] = updated_input;',
        '  if (state.remaining.length > 0) {',
        '    // More tool calls queued – throw so the reject path loops back to prepare_call.',
        '    throw { request: updated_request, tool_calls: state.remaining };',
        '  }',
        '  // All tool calls for this turn are done – return so call_api gets the updated request.',
        '  return { request: updated_request };',
        '};',
      ].join('\n'),
    }, 'call_api', 'prepare_call'),

    // ── 7. Return the final model response ───────────────────────────────────
    // $last is the thrown { done: true, response } object from extract_calls.
    operation('finalize', 'run_script', {
      code: [
        'module.exports = async function(data) {',
        '  return data.$last && data.$last.response !== undefined',
        '    ? data.$last.response',
        '    : data.$last;',
        '};',
      ].join('\n'),
    }),
  ],
};

// ─── All default tools ────────────────────────────────────────────────────────

export const DEFAULT_TOOLS = [
  // tool management
  LIST_COLLATIONS_TOOL,
  CREATE_TOOL_TOOL,
  EDIT_TOOL_TOOL,
  DELETE_COMPOSED_TOOL_TOOL,
  LIST_COMPOSED_TOOLS_TOOL,
  TEST_COMPOSED_TOOL_TOOL,

  // operation management
  LIST_OPERATION_TYPES_TOOL,
  DELETE_OPERATION_TOOL,

    // script operations
    ADD_RUN_SCRIPT_OPERATION_TOOL,
    EDIT_RUN_SCRIPT_OPERATION_TOOL,

    // fetch_request operations
    ADD_FETCH_REQUEST_OPERATION_TOOL,
    EDIT_FETCH_REQUEST_OPERATION_TOOL,

    // call_tool operations
    ADD_CALL_TOOL_OPERATION_TOOL,
    EDIT_CALL_TOOL_OPERATION_TOOL,

    // agentic / LLM operations
    MESSAGE_V1_RESPONSES_TOOL,
];
