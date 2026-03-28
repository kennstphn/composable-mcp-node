/**
 * Default tool definitions for the "default" collation.
 *
 * These five tools let an authenticated user manage tool definitions
 * inside Directus through the MCP / REST interface.  They rely on:
 *
 *   • `$env.DIRECTUS_BASE_URL`  — injected by the server into every flow
 *   • `$env.DIRECTUS_TOKEN`     — the caller's bearer token, also injected
 *
 * Each tool is a plain object matching the shape that `fetchToolsForCollation`
 * returns from Directus (slug, name, description, inputSchema, start_slug,
 * operations[]).  Seeding them into Directus makes them available to every
 * caller of the "default" collation.
 */

// ─── list_operation_types ─────────────────────────────────────────────────────

export const LIST_OPERATION_TYPES_TOOL = {
  slug: 'list_operation_types',
  name: 'List Operation Types',
  description: 'Returns the operation types supported by this server.',
  tool_collation: 'default',
  inputSchema: { type: 'object', properties: {} },
  start_slug: 'return_types',
  operations: [
    {
      slug: 'return_types',
      type: 'run_script',
      config: {
        code: 'module.exports = async function() { return ["run_script", "fetch_request"]; };',
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
  tool_collation: 'default',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer {{$env.DIRECTUS_TOKEN}}',
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

// ─── add_operation ────────────────────────────────────────────────────────────

export const ADD_OPERATION_TOOL = {
  slug: 'add_operation',
  name: 'Add Operation',
  description: 'Adds an operation step to an existing tool.',
  tool_collation: 'default',
  inputSchema: {
    type: 'object',
    properties: {
      tool_id:  { type: 'integer', description: 'ID of the parent tool' },
      slug:     { type: 'string',  description: 'Unique slug for this operation within the tool' },
      type:     { type: 'string',  enum: ['run_script', 'fetch_request'], description: 'Operation type' },
      config:   { type: 'object',  description: 'Type-specific configuration' },
      resolve:  { type: 'string',  description: 'Slug of next operation on success (omit to stop)' },
      reject:   { type: 'string',  description: 'Slug of next operation on error (omit to stop)' },
    },
    required: ['tool_id', 'slug', 'type', 'config'],
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
          'Authorization': 'Bearer {{$env.DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: {
          tool:    '{{tool_id}}',
          slug:    '{{slug}}',
          type:    '{{type}}',
          config:  '{{config}}',
          resolve: '{{resolve}}',
          reject:  '{{reject}}',
        },
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
  tool_collation: 'default',
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
          '  const patch = {};',
          '  const fields = ["slug","name","description","tool_collation","inputSchema","start_slug"];',
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
        url: '{{$env.DIRECTUS_BASE_URL}}/items/tools/{{tool_id}}',
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer {{$env.DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: '{{$last}}',
      },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── edit_operation ───────────────────────────────────────────────────────────

export const EDIT_OPERATION_TOOL = {
  slug: 'edit_operation',
  name: 'Edit Operation',
  description: 'Updates fields on an existing operation step.  Only supplied fields are changed.',
  tool_collation: 'default',
  inputSchema: {
    type: 'object',
    properties: {
      operation_id: { type: 'integer', description: 'ID of the operation to update' },
      slug:         { type: 'string' },
      type:         { type: 'string', enum: ['run_script', 'fetch_request'] },
      config:       { type: 'object' },
      resolve:      { type: 'string' },
      reject:       { type: 'string' },
    },
    required: ['operation_id'],
  },
  start_slug: 'build_patch',
  operations: [
    {
      slug: 'build_patch',
      type: 'run_script',
      config: {
        code: [
          'module.exports = async function(data) {',
          '  const patch = {};',
          '  const fields = ["slug","type","config","resolve","reject"];',
          '  for (const f of fields) {',
          '    if (data[f] !== undefined) patch[f] = data[f];',
          '  }',
          '  return patch;',
          '};',
        ].join('\n'),
      },
      resolve: 'patch_operation',
      reject: null,
    },
    {
      slug: 'patch_operation',
      type: 'fetch_request',
      config: {
        url: '{{$env.DIRECTUS_BASE_URL}}/items/operations/{{operation_id}}',
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer {{$env.DIRECTUS_TOKEN}}',
          'Content-Type': 'application/json',
        },
        body: '{{$last}}',
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
  ADD_OPERATION_TOOL,
  EDIT_TOOL_TOOL,
  EDIT_OPERATION_TOOL,
];

// ─── Seeding helper ───────────────────────────────────────────────────────────

/**
 * Ensure every default tool exists in the "default" collation.
 * Tools are identified by slug; existing ones are left untouched.
 *
 * @param {string} baseUrl  - Directus base URL
 * @param {string} token    - Bearer token
 * @returns {object}        - Summary of actions taken
 */
export async function seedDefaultTools(baseUrl, token) {
  // Fetch all tools in the default collation to check which already exist
  const url = new URL('/items/tools', baseUrl);
  url.searchParams.set('filter[tool_collation][_eq]', 'default');
  url.searchParams.set('fields', 'slug');

  const listRes = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!listRes.ok) {
    throw new Error(`Failed to list default tools: Directus returned ${listRes.status}`);
  }

  const { data: existingTools } = await listRes.json();
  const existingSlugs = new Set((existingTools || []).map(t => t.slug));

  const actions = [];

  for (const tool of DEFAULT_TOOLS) {
    if (existingSlugs.has(tool.slug)) {
      actions.push({ action: 'already_exists', resource: `tool:${tool.slug}` });
      continue;
    }

    // POST the tool (without nested operations — they'll be added separately)
    const { operations, ...toolData } = tool;

    const toolRes = await fetch(new URL('/items/tools', baseUrl).toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toolData),
    });

    if (!toolRes.ok) {
      const err = await toolRes.json().catch(() => ({}));
      throw new Error(`Failed to create tool "${tool.slug}": ${JSON.stringify(err)}`);
    }

    const { data: createdTool } = await toolRes.json();
    actions.push({ action: 'created', resource: `tool:${tool.slug}` });

    // POST each operation linked to the created tool
    for (const op of operations) {
      const opRes = await fetch(new URL('/items/operations', baseUrl).toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...op, tool: createdTool.id }),
      });

      if (!opRes.ok) {
        const err = await opRes.json().catch(() => ({}));
        throw new Error(
          `Failed to create operation "${op.slug}" for tool "${tool.slug}": ${JSON.stringify(err)}`,
        );
      }

      actions.push({ action: 'created', resource: `operation:${tool.slug}/${op.slug}` });
    }
  }

  return { actions };
}
