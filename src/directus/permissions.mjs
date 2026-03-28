/**
 * Directus permissions helpers.
 *
 * Sets up per-user CRUD permissions on the `tools` and `operations`
 * collections so that items are visible / editable only by the user who
 * created them (`user_created = $CURRENT_USER`).
 *
 * Requires a token with sufficient rights to read `/users/me` and
 * write to `/permissions`.
 */

// ─── Low-level helper (shared pattern with schema.mjs) ───────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch the current user's role UUID.
 * Returns null when the endpoint is unavailable (e.g., public tokens).
 */
export async function getCurrentUserRole(baseUrl, token) {
  const { ok, data } = await directusFetch(baseUrl, token, '/users/me?fields=role');
  if (!ok || !data?.data?.role) return null;
  return data.data.role;
}

/**
 * Check whether a permission already exists for the given role + collection + action.
 */
async function permissionExists(baseUrl, token, roleId, collection, action) {
  const { ok, data } = await directusFetch(
    baseUrl,
    token,
    `/permissions?filter[role][_eq]=${roleId}&filter[collection][_eq]=${collection}&filter[action][_eq]=${action}&limit=1`,
  );
  if (!ok) return false;
  return Array.isArray(data?.data) && data.data.length > 0;
}

/**
 * Create a single permission entry if one does not already exist.
 */
async function ensurePermission(baseUrl, token, permission) {
  const exists = await permissionExists(
    baseUrl,
    token,
    permission.role,
    permission.collection,
    permission.action,
  );
  if (exists) {
    return { created: false, permission: `${permission.collection}:${permission.action}` };
  }

  const { ok, data } = await directusFetch(baseUrl, token, '/permissions', 'POST', permission);
  if (!ok) {
    // Non-fatal: log and continue (e.g., admin role needs no extra permissions)
    return {
      created: false,
      skipped: true,
      reason: JSON.stringify(data),
      permission: `${permission.collection}:${permission.action}`,
    };
  }
  return { created: true, permission: `${permission.collection}:${permission.action}` };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Ensure the caller's Directus role has CRUD permissions on `tools` and
 * `operations`, filtered so each user can only see and modify their own items.
 *
 * @param {string} baseUrl - Directus base URL
 * @param {string} token   - Bearer token of the user whose role to configure
 * @returns {object}       - Summary of actions taken
 */
export async function setupPermissions(baseUrl, token) {
  const roleId = await getCurrentUserRole(baseUrl, token);

  if (!roleId) {
    return {
      actions: [{
        action: 'skipped',
        resource: 'permissions',
        reason: 'Could not determine user role — permissions not configured',
      }],
    };
  }

  const ownedFilter = { user_created: { _eq: '$CURRENT_USER' } };

  const permissionsToCreate = [
    // tools ─ CREATE (preset ensures user_created is populated)
    {
      role: roleId,
      collection: 'tools',
      action: 'create',
      permissions: {},
      validation: {},
      presets: { user_created: '$CURRENT_USER' },
      fields: '*',
    },
    // tools ─ READ own items
    {
      role: roleId,
      collection: 'tools',
      action: 'read',
      permissions: ownedFilter,
      validation: {},
      presets: null,
      fields: '*',
    },
    // tools ─ UPDATE own items
    {
      role: roleId,
      collection: 'tools',
      action: 'update',
      permissions: ownedFilter,
      validation: {},
      presets: null,
      fields: '*',
    },
    // tools ─ DELETE own items
    {
      role: roleId,
      collection: 'tools',
      action: 'delete',
      permissions: ownedFilter,
      validation: {},
      presets: null,
      fields: '*',
    },
    // operations ─ CREATE
    {
      role: roleId,
      collection: 'operations',
      action: 'create',
      permissions: {},
      validation: {},
      presets: { user_created: '$CURRENT_USER' },
      fields: '*',
    },
    // operations ─ READ own items
    {
      role: roleId,
      collection: 'operations',
      action: 'read',
      permissions: ownedFilter,
      validation: {},
      presets: null,
      fields: '*',
    },
    // operations ─ UPDATE own items
    {
      role: roleId,
      collection: 'operations',
      action: 'update',
      permissions: ownedFilter,
      validation: {},
      presets: null,
      fields: '*',
    },
    // operations ─ DELETE own items
    {
      role: roleId,
      collection: 'operations',
      action: 'delete',
      permissions: ownedFilter,
      validation: {},
      presets: null,
      fields: '*',
    },
  ];

  const actions = [];
  for (const perm of permissionsToCreate) {
    const result = await ensurePermission(baseUrl, token, perm);
    actions.push({
      action: result.created ? 'created' : (result.skipped ? 'skipped' : 'already_exists'),
      resource: `permission:${result.permission}`,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }

  return { actions };
}
