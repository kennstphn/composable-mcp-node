/**
 * Directus schema initialization helpers.
 *
 * Checks for and creates the `tools` and `operations` collections
 * (including the M2O / O2M relation between them) required by
 * composable-mcp-node.
 */

// ─── Collection schemas ───────────────────────────────────────────────────────

export const TOOLS_SCHEMA = {
  collection: 'tools',
  meta: {
    icon: 'build',
    note: 'Composable MCP tool definitions',
    accountability: 'all',
  },
  schema: { name: 'tools' },
  fields: [
    {
      field: 'id',
      type: 'integer',
      meta: { hidden: true, readonly: true, interface: 'input', special: ['cast-to-int'] },
      schema: { is_primary_key: true, has_auto_increment: true },
    },
    {
      field: 'slug',
      type: 'string',
      meta: { required: true, interface: 'input', options: { placeholder: 'my-tool' } },
      schema: { is_nullable: false },
    },
    {
      field: 'name',
      type: 'string',
      meta: { required: true, interface: 'input' },
      schema: { is_nullable: false },
    },
    {
      field: 'description',
      type: 'text',
      meta: { interface: 'input-multiline' },
      schema: {},
    },
    {
      field: 'tool_collation',
      type: 'string',
      meta: { required: true, interface: 'input', options: { placeholder: 'default' } },
      schema: { is_nullable: false },
    },
    {
      field: 'inputSchema',
      type: 'json',
      meta: { interface: 'input-code', options: { language: 'json' } },
      schema: {},
    },
    {
      field: 'start_slug',
      type: 'string',
      meta: { required: true, interface: 'input' },
      schema: { is_nullable: false },
    },
    {
      field: 'user_created',
      type: 'uuid',
      meta: { special: ['user-created'], interface: 'select-dropdown-m2o', readonly: true, hidden: true },
      schema: {},
    },
    {
      field: 'date_created',
      type: 'timestamp',
      meta: { special: ['date-created'], interface: 'datetime', readonly: true, hidden: true },
      schema: {},
    },
  ],
};

export const OPERATIONS_SCHEMA = {
  collection: 'operations',
  meta: {
    icon: 'settings',
    note: 'Individual steps within a tool flow',
    accountability: 'all',
  },
  schema: { name: 'operations' },
  fields: [
    {
      field: 'id',
      type: 'integer',
      meta: { hidden: true, readonly: true, interface: 'input', special: ['cast-to-int'] },
      schema: { is_primary_key: true, has_auto_increment: true },
    },
    {
      field: 'slug',
      type: 'string',
      meta: { required: true, interface: 'input' },
      schema: { is_nullable: false },
    },
    {
      field: 'type',
      type: 'string',
      meta: {
        required: true,
        interface: 'select-dropdown',
        options: {
          choices: [
            { text: 'Run Script', value: 'run_script' },
            { text: 'Fetch Request', value: 'fetch_request' },
          ],
        },
      },
      schema: { is_nullable: false },
    },
    {
      field: 'config',
      type: 'json',
      meta: { interface: 'input-code', options: { language: 'json' } },
      schema: {},
    },
    {
      field: 'resolve',
      type: 'string',
      meta: { interface: 'input', note: 'Slug of next operation on success (null = stop)' },
      schema: {},
    },
    {
      field: 'reject',
      type: 'string',
      meta: { interface: 'input', note: 'Slug of next operation on error (null = stop)' },
      schema: {},
    },
    {
      field: 'tool',
      type: 'integer',
      meta: { interface: 'select-dropdown-m2o', special: ['m2o'] },
      schema: {
        is_nullable: true,
        foreign_key_table: 'tools',
        foreign_key_column: 'id',
      },
    },
    {
      field: 'user_created',
      type: 'uuid',
      meta: { special: ['user-created'], interface: 'select-dropdown-m2o', readonly: true, hidden: true },
      schema: {},
    },
    {
      field: 'date_created',
      type: 'timestamp',
      meta: { special: ['date-created'], interface: 'datetime', readonly: true, hidden: true },
      schema: {},
    },
  ],
};

/** O2M alias field to add to the `tools` collection after the relation is created */
export const TOOLS_OPERATIONS_ALIAS = {
  field: 'operations',
  type: 'alias',
  meta: {
    interface: 'list-o2m',
    special: ['o2m'],
    options: { fields: ['slug', 'type', 'resolve', 'reject'] },
  },
};

/** Relation: operations.tool → tools.id (M2O), with operations as the O2M alias on tools */
export const OPERATIONS_TOOL_RELATION = {
  collection: 'operations',
  field: 'tool',
  related_collection: 'tools',
  meta: {
    one_field: 'operations',
    sort_field: null,
    one_deselect_action: 'nullify',
  },
  schema: { on_delete: 'SET NULL' },
};

// ─── Low-level Directus fetch helper ─────────────────────────────────────────

/**
 * Make an authenticated request to Directus and return
 * `{ status, ok, data }` (data is null for 204 responses).
 */
async function directusFetch(baseUrl, token, path, method = 'GET', body = undefined) {
  const url = new URL(path, baseUrl);
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url.toString(), options);
  if (response.status === 204) return { status: 204, ok: true, data: null };
  const data = await response.json();
  return { status: response.status, ok: response.ok, data };
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

async function collectionExists(baseUrl, token, collectionName) {
  const { status } = await directusFetch(baseUrl, token, `/collections/${collectionName}`);
  return status !== 404;
}

export async function ensureCollection(baseUrl, token, schema) {
  if (await collectionExists(baseUrl, token, schema.collection)) {
    return { created: false, collection: schema.collection };
  }
  const result = await directusFetch(baseUrl, token, '/collections', 'POST', schema);
  if (!result.ok) {
    throw new Error(
      `Failed to create collection "${schema.collection}": ${JSON.stringify(result.data)}`,
    );
  }
  return { created: true, collection: schema.collection };
}

async function fieldExists(baseUrl, token, collection, fieldName) {
  const { status } = await directusFetch(baseUrl, token, `/fields/${collection}/${fieldName}`);
  return status !== 404;
}

export async function ensureField(baseUrl, token, collection, field) {
  if (await fieldExists(baseUrl, token, collection, field.field)) {
    return { created: false, field: field.field };
  }
  const result = await directusFetch(baseUrl, token, `/fields/${collection}`, 'POST', field);
  if (!result.ok) {
    throw new Error(
      `Failed to create field "${field.field}" on "${collection}": ${JSON.stringify(result.data)}`,
    );
  }
  return { created: true, field: field.field };
}

async function relationExists(baseUrl, token, collection, field) {
  const { status } = await directusFetch(baseUrl, token, `/relations/${collection}/${field}`);
  return status !== 404;
}

export async function ensureRelation(baseUrl, token, relation) {
  if (await relationExists(baseUrl, token, relation.collection, relation.field)) {
    return { created: false };
  }
  const result = await directusFetch(baseUrl, token, '/relations', 'POST', relation);
  if (!result.ok) {
    throw new Error(`Failed to create relation: ${JSON.stringify(result.data)}`);
  }
  return { created: true };
}

// ─── Initialization state check ───────────────────────────────────────────────

/**
 * Probe Directus to determine the current initialization state.
 *
 * States:
 *  - `needed`           — neither `tools` nor `operations` collection exists
 *  - `in_progress`      — collections exist but setup is incomplete (missing
 *                         relation, or default tools not yet seeded)
 *  - `migration_needed` — collections exist but one or more expected fields are
 *                         absent (schema was updated in a newer app version)
 *  - `complete`         — everything is in place
 *
 * Throws with `err.status` set to 401/403 when the token is rejected by Directus.
 *
 * @param {string} baseUrl - Directus base URL
 * @param {string} token   - Bearer token with at least schema-read rights
 * @returns {Promise<'needed'|'in_progress'|'migration_needed'|'complete'>}
 */
export async function checkInitializationState(baseUrl, token) {
  // 1. Check whether the two core collections exist.
  const toolsRes = await directusFetch(baseUrl, token, '/collections/tools');
  if (toolsRes.status === 401 || toolsRes.status === 403) {
    const err = new Error('Directus authorization failed');
    err.status = toolsRes.status;
    throw err;
  }
  const toolsExists = toolsRes.status !== 404;

  const opsRes = await directusFetch(baseUrl, token, '/collections/operations');
  if (opsRes.status === 401 || opsRes.status === 403) {
    const err = new Error('Directus authorization failed');
    err.status = opsRes.status;
    throw err;
  }
  const opsExists = opsRes.status !== 404;

  if (!toolsExists && !opsExists) return 'needed';
  if (!toolsExists || !opsExists) return 'in_progress';

  // 2. Both collections present — check for missing fields (migration needed?).
  const [toolFieldsRes, opsFieldsRes] = await Promise.all([
    directusFetch(baseUrl, token, '/fields/tools'),
    directusFetch(baseUrl, token, '/fields/operations'),
  ]);

  if (toolFieldsRes.ok && opsFieldsRes.ok) {
    const existingToolFields = new Set(
      (toolFieldsRes.data?.data || []).map(f => f.field),
    );
    const existingOpsFields = new Set(
      (opsFieldsRes.data?.data || []).map(f => f.field),
    );

    const missingToolFields = TOOLS_SCHEMA.fields
      .map(f => f.field)
      .filter(name => !existingToolFields.has(name));
    const missingOpsFields = OPERATIONS_SCHEMA.fields
      .map(f => f.field)
      .filter(name => !existingOpsFields.has(name));

    if (missingToolFields.length > 0 || missingOpsFields.length > 0) {
      return 'migration_needed';
    }
  }

  // 3. Check that the M2O relation exists.
  const relRes = await directusFetch(baseUrl, token, '/relations/operations/tool');
  if (relRes.status === 404) return 'in_progress';

  // 4. Check that at least one default-collation tool has been seeded.
  const defaultRes = await directusFetch(
    baseUrl,
    token,
    '/items/tools?filter[tool_collation][_eq]=default&limit=1&fields=id',
  );
  if (defaultRes.ok && (defaultRes.data?.data?.length ?? 0) > 0) {
    return 'complete';
  }

  return 'in_progress';
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Ensure the `tools` and `operations` collections exist in Directus,
 * with the correct fields and relations.
 *
 * @param {string} baseUrl  - Directus base URL
 * @param {string} token    - Bearer token with schema-modification rights
 * @returns {object}        - Summary of actions taken
 */
export async function initializeSchema(baseUrl, token) {
  const actions = [];

  // 1. tools collection
  const toolsResult = await ensureCollection(baseUrl, token, TOOLS_SCHEMA);
  actions.push({
    action: toolsResult.created ? 'created' : 'already_exists',
    resource: 'collection:tools',
  });

  // 2. operations collection (without the tool M2O field — that's created via the relation)
  const opsSchemaWithoutRelation = {
    ...OPERATIONS_SCHEMA,
    fields: OPERATIONS_SCHEMA.fields.filter(f => f.field !== 'tool'),
  };
  const opsResult = await ensureCollection(baseUrl, token, opsSchemaWithoutRelation);
  actions.push({
    action: opsResult.created ? 'created' : 'already_exists',
    resource: 'collection:operations',
  });

  // 3. M2O relation: operations.tool → tools.id (also creates the O2M alias on tools)
  const relationResult = await ensureRelation(baseUrl, token, OPERATIONS_TOOL_RELATION);
  actions.push({
    action: relationResult.created ? 'created' : 'already_exists',
    resource: 'relation:operations.tool→tools',
  });

  return { actions };
}
