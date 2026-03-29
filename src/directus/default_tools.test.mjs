import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOOLS,
  ADD_RUN_SCRIPT_OPERATION_TOOL,
  ADD_FETCH_REQUEST_OPERATION_TOOL,
  EDIT_RUN_SCRIPT_OPERATION_TOOL,
  EDIT_FETCH_REQUEST_OPERATION_TOOL,
  LIST_COLLATIONS_TOOL,
  LIST_COMPOSED_TOOLS_TOOL,
  RUN_COMPOSED_TOOL_TOOL,
  DELETE_COMPOSED_TOOL_TOOL,
} from './default_tools.mjs';
import { ScriptOperation } from '../operations/ScriptOperation.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run the embedded run_script code from an operation definition and return
 * the result, simulating how run_operations.mjs executes it.
 * The result is JSON-roundtripped to avoid cross-VM-realm object comparison
 * failures in assert.deepStrictEqual.
 *
 * Note: at runtime the `/mcp` route also injects `DIRECTUS_BASE_URL` and
 * `DIRECTUS_TOKEN` as top-level context keys.  The scripts tested here
 * (build_body, build_patch) only read user-provided input fields and do not
 * touch those keys, so they are intentionally omitted from this helper.
 */
async function runEmbeddedScript(operation, inputData) {
  const scriptOp = new ScriptOperation(operation.config);
  const result = await scriptOp.run({ ...inputData, $last: null, $env: {}, $vars: {} });
  return JSON.parse(JSON.stringify(result));
}

// ─── DEFAULT_TOOLS array ──────────────────────────────────────────────────────

describe('DEFAULT_TOOLS', () => {
  it('contains eleven tools', () => {
    assert.equal(DEFAULT_TOOLS.length, 11);
  });

  it('includes all four operation-editing tools and the four new composed-tool management tools', () => {
    const slugs = DEFAULT_TOOLS.map(t => t.slug);
    assert.ok(slugs.includes('add_run_script_operation'));
    assert.ok(slugs.includes('add_fetch_request_operation'));
    assert.ok(slugs.includes('edit_run_script_operation'));
    assert.ok(slugs.includes('edit_fetch_request_operation'));
    assert.ok(slugs.includes('list_collations'));
    assert.ok(slugs.includes('list_composed_tools'));
    assert.ok(slugs.includes('run_composed_tool'));
    assert.ok(slugs.includes('delete_composed_tool'));
    assert.ok(!slugs.includes('add_operation'), 'old add_operation should be removed');
    assert.ok(!slugs.includes('edit_operation'), 'old edit_operation should be removed');
  });

  it('every tool has the required shape fields', () => {
    for (const tool of DEFAULT_TOOLS) {
      assert.ok(tool.slug,          `${tool.slug}: missing slug`);
      assert.ok(tool.name,          `${tool.slug}: missing name`);
      assert.ok(tool.start_slug,    `${tool.slug}: missing start_slug`);
      assert.ok(Array.isArray(tool.operations), `${tool.slug}: operations must be an array`);
      assert.ok(tool.operations.length > 0,     `${tool.slug}: operations must not be empty`);
    }
  });

  it('no tool has a tool_collation field (they are filesystem-side, not stored in Directus)', () => {
    for (const tool of DEFAULT_TOOLS) {
      assert.ok(!('tool_collation' in tool), `${tool.slug}: should not have tool_collation`);
    }
  });

  it('fetch_request operations use {{DIRECTUS_BASE_URL}} and {{DIRECTUS_TOKEN}}, not $env', () => {
    for (const tool of DEFAULT_TOOLS) {
      for (const op of tool.operations) {
        if (op.type !== 'fetch_request') continue;
        const url = op.config?.url || '';
        const auth = op.config?.headers?.Authorization || '';
        assert.ok(!url.includes('$env'),  `${tool.slug}/${op.slug}: url must not reference $env`);
        assert.ok(!auth.includes('$env'), `${tool.slug}/${op.slug}: Authorization must not reference $env`);
        if (url.includes('DIRECTUS')) {
          assert.ok(url.includes('{{DIRECTUS_BASE_URL}}'), `${tool.slug}/${op.slug}: url should use {{DIRECTUS_BASE_URL}}`);
        }
        if (auth.includes('DIRECTUS')) {
          assert.ok(auth.includes('{{DIRECTUS_TOKEN}}'), `${tool.slug}/${op.slug}: Authorization should use {{DIRECTUS_TOKEN}}`);
        }
      }
    }
  });
});

// ─── add_run_script_operation ─────────────────────────────────────────────────

describe('ADD_RUN_SCRIPT_OPERATION_TOOL', () => {
  it('has slug add_run_script_operation', () => {
    assert.equal(ADD_RUN_SCRIPT_OPERATION_TOOL.slug, 'add_run_script_operation');
  });

  it('requires tool_id, slug, and code', () => {
    assert.deepEqual(
      ADD_RUN_SCRIPT_OPERATION_TOOL.inputSchema.required,
      ['tool_id', 'slug', 'code'],
    );
  });

  it('inputSchema does not include a generic config or type field', () => {
    const props = Object.keys(ADD_RUN_SCRIPT_OPERATION_TOOL.inputSchema.properties);
    assert.ok(!props.includes('type'),   'should not have a generic type field');
    assert.ok(!props.includes('config'), 'should not have a generic config field');
    assert.ok(props.includes('code'),    'should have a code field');
  });

  it('has a single fetch_request operation that embeds type=run_script in the body', () => {
    assert.equal(ADD_RUN_SCRIPT_OPERATION_TOOL.operations.length, 1);
    const op = ADD_RUN_SCRIPT_OPERATION_TOOL.operations[0];
    assert.equal(op.type, 'fetch_request');
    assert.equal(op.config.body.type, 'run_script');
  });

  it('passes code as config.code in the Directus POST body', () => {
    const body = ADD_RUN_SCRIPT_OPERATION_TOOL.operations[0].config.body;
    assert.deepEqual(body.config, { code: '{{code}}' });
  });
});

// ─── add_fetch_request_operation ──────────────────────────────────────────────

describe('ADD_FETCH_REQUEST_OPERATION_TOOL', () => {
  it('has slug add_fetch_request_operation', () => {
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.slug, 'add_fetch_request_operation');
  });

  it('requires tool_id, slug, and url', () => {
    assert.deepEqual(
      ADD_FETCH_REQUEST_OPERATION_TOOL.inputSchema.required,
      ['tool_id', 'slug', 'url'],
    );
  });

  it('inputSchema has url, method, headers, body fields but no generic config or type', () => {
    const props = Object.keys(ADD_FETCH_REQUEST_OPERATION_TOOL.inputSchema.properties);
    assert.ok(!props.includes('type'),   'should not have a generic type field');
    assert.ok(!props.includes('config'), 'should not have a generic config field');
    assert.ok(props.includes('url'));
    assert.ok(props.includes('method'));
    assert.ok(props.includes('headers'));
    assert.ok(props.includes('body'));
  });

  it('has two operations: build_body (run_script) then post_operation (fetch_request)', () => {
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.operations.length, 2);
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.operations[0].slug, 'build_body');
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.operations[0].type, 'run_script');
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.operations[1].slug, 'post_operation');
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.operations[1].type, 'fetch_request');
  });

  it('build_body script produces correct Directus document with only url', async () => {
    const buildBodyOp = ADD_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildBodyOp, {
      tool_id: 42,
      slug: 'my_step',
      url: 'https://api.example.com/data',
    });
    assert.deepEqual(result, {
      tool:    42,
      slug:    'my_step',
      type:    'fetch_request',
      config:  { url: 'https://api.example.com/data' },
      resolve: null,
      reject:  null,
    });
  });

  it('build_body script includes optional config fields when provided', async () => {
    const buildBodyOp = ADD_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildBodyOp, {
      tool_id:  7,
      slug:     'fetch_step',
      url:      'https://api.example.com/items',
      method:   'POST',
      headers:  { 'Authorization': 'Bearer token' },
      body:     { key: 'value' },
      resolve:  'next_step',
      reject:   'error_step',
    });
    assert.deepEqual(result, {
      tool:    7,
      slug:    'fetch_step',
      type:    'fetch_request',
      config:  {
        url:     'https://api.example.com/items',
        method:  'POST',
        headers: { 'Authorization': 'Bearer token' },
        body:    { key: 'value' },
      },
      resolve: 'next_step',
      reject:  'error_step',
    });
  });

  it('build_body script omits method/headers/body when not provided', async () => {
    const buildBodyOp = ADD_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildBodyOp, {
      tool_id: 1,
      slug:    'get_step',
      url:     'https://example.com',
    });
    assert.ok(!('method'  in result.config), 'method should not be set');
    assert.ok(!('headers' in result.config), 'headers should not be set');
    assert.ok(!('body'    in result.config), 'body should not be set');
  });
});

// ─── edit_run_script_operation ────────────────────────────────────────────────

describe('EDIT_RUN_SCRIPT_OPERATION_TOOL', () => {
  it('has slug edit_run_script_operation', () => {
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.slug, 'edit_run_script_operation');
  });

  it('requires only operation_id', () => {
    assert.deepEqual(EDIT_RUN_SCRIPT_OPERATION_TOOL.inputSchema.required, ['operation_id']);
  });

  it('inputSchema has code field but no generic type or config fields', () => {
    const props = Object.keys(EDIT_RUN_SCRIPT_OPERATION_TOOL.inputSchema.properties);
    assert.ok(!props.includes('type'),   'should not have a generic type field');
    assert.ok(!props.includes('config'), 'should not have a generic config field');
    assert.ok(props.includes('code'),    'should have a code field');
  });

  it('has two operations: build_patch (run_script) then patch_operation (fetch_request)', () => {
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.operations.length, 2);
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0].slug, 'build_patch');
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0].type, 'run_script');
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[1].slug, 'patch_operation');
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[1].type, 'fetch_request');
  });

  it('build_patch script returns empty patch when only operation_id is supplied', async () => {
    const buildPatchOp = EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, { operation_id: 5 });
    assert.deepEqual(result, {});
  });

  it('build_patch script wraps code in config object', async () => {
    const buildPatchOp = EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      operation_id: 5,
      code: 'module.exports = async function(data) { return 42; };',
    });
    assert.deepEqual(result, {
      config: { code: 'module.exports = async function(data) { return 42; };' },
    });
  });

  it('build_patch script includes slug, resolve, reject when provided', async () => {
    const buildPatchOp = EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      operation_id: 5,
      slug:    'new_slug',
      code:    'module.exports = async function() { return 1; };',
      resolve: 'next',
      reject:  'err',
    });
    assert.deepEqual(result, {
      slug:    'new_slug',
      resolve: 'next',
      reject:  'err',
      config:  { code: 'module.exports = async function() { return 1; };' },
    });
  });
});

// ─── edit_fetch_request_operation ─────────────────────────────────────────────

describe('EDIT_FETCH_REQUEST_OPERATION_TOOL', () => {
  it('has slug edit_fetch_request_operation', () => {
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.slug, 'edit_fetch_request_operation');
  });

  it('requires only operation_id', () => {
    assert.deepEqual(EDIT_FETCH_REQUEST_OPERATION_TOOL.inputSchema.required, ['operation_id']);
  });

  it('inputSchema has url, method, headers, body fields but no generic type or config', () => {
    const props = Object.keys(EDIT_FETCH_REQUEST_OPERATION_TOOL.inputSchema.properties);
    assert.ok(!props.includes('type'),   'should not have a generic type field');
    assert.ok(!props.includes('config'), 'should not have a generic config field');
    assert.ok(props.includes('url'));
    assert.ok(props.includes('method'));
    assert.ok(props.includes('headers'));
    assert.ok(props.includes('body'));
  });

  it('has two operations: build_patch (run_script) then patch_operation (fetch_request)', () => {
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.operations.length, 2);
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0].slug, 'build_patch');
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0].type, 'run_script');
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[1].slug, 'patch_operation');
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[1].type, 'fetch_request');
  });

  it('build_patch script returns empty patch when only operation_id is supplied', async () => {
    const buildPatchOp = EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, { operation_id: 9 });
    assert.deepEqual(result, {});
  });

  it('build_patch script groups url/method/headers/body under config', async () => {
    const buildPatchOp = EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      operation_id: 9,
      url:    'https://new.example.com',
      method: 'DELETE',
    });
    assert.deepEqual(result, {
      config: { url: 'https://new.example.com', method: 'DELETE' },
    });
  });

  it('build_patch script includes slug, resolve, reject alongside config', async () => {
    const buildPatchOp = EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      operation_id: 9,
      slug:    'updated_step',
      url:     'https://api.example.com/v2',
      headers: { 'X-Custom': 'val' },
      body:    { data: 1 },
      resolve: 'on_success',
      reject:  'on_fail',
    });
    assert.deepEqual(result, {
      slug:    'updated_step',
      resolve: 'on_success',
      reject:  'on_fail',
      config:  {
        url:     'https://api.example.com/v2',
        headers: { 'X-Custom': 'val' },
        body:    { data: 1 },
      },
    });
  });

  it('build_patch script does not set config when no config fields are provided', async () => {
    const buildPatchOp = EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      operation_id: 9,
      slug:    'rename_only',
      resolve: 'next',
    });
    assert.deepEqual(result, { slug: 'rename_only', resolve: 'next' });
    assert.ok(!('config' in result), 'config should not be set when no config fields supplied');
  });
});

// ─── list_collations ──────────────────────────────────────────────────────────

describe('LIST_COLLATIONS_TOOL', () => {
  it('has slug list_collations', () => {
    assert.equal(LIST_COLLATIONS_TOOL.slug, 'list_collations');
  });

  it('has no required inputs', () => {
    assert.ok(!LIST_COLLATIONS_TOOL.inputSchema.required || LIST_COLLATIONS_TOOL.inputSchema.required.length === 0);
  });

  it('has two operations: fetch_collations (fetch_request) then extract_names (run_script)', () => {
    assert.equal(LIST_COLLATIONS_TOOL.operations.length, 2);
    assert.equal(LIST_COLLATIONS_TOOL.operations[0].slug, 'fetch_collations');
    assert.equal(LIST_COLLATIONS_TOOL.operations[0].type, 'fetch_request');
    assert.equal(LIST_COLLATIONS_TOOL.operations[1].slug, 'extract_names');
    assert.equal(LIST_COLLATIONS_TOOL.operations[1].type, 'run_script');
  });

  it('fetch_collations URL uses groupBy[]=tool_collation', () => {
    const url = LIST_COLLATIONS_TOOL.operations[0].config.url;
    assert.ok(url.includes('groupBy'), 'URL should use groupBy');
    assert.ok(url.includes('tool_collation'));
  });

  it('extract_names script unwraps the Directus data array into a flat string array', async () => {
    const extractOp = LIST_COLLATIONS_TOOL.operations[1];
    const result = await runEmbeddedScript(extractOp, {
      fetch_collations: { data: [{ tool_collation: 'pco' }, { tool_collation: 'test' }] },
    });
    assert.deepEqual(result, ['pco', 'test']);
  });

  it('extract_names script returns an empty array when data is empty', async () => {
    const extractOp = LIST_COLLATIONS_TOOL.operations[1];
    const result = await runEmbeddedScript(extractOp, {
      fetch_collations: { data: [] },
    });
    assert.deepEqual(result, []);
  });

  it('extract_names script filters out falsy tool_collation values', async () => {
    const extractOp = LIST_COLLATIONS_TOOL.operations[1];
    const result = await runEmbeddedScript(extractOp, {
      fetch_collations: { data: [{ tool_collation: 'a' }, { tool_collation: null }, { tool_collation: 'b' }] },
    });
    assert.deepEqual(result, ['a', 'b']);
  });
});

// ─── list_composed_tools ──────────────────────────────────────────────────────

describe('LIST_COMPOSED_TOOLS_TOOL', () => {
  it('has slug list_composed_tools', () => {
    assert.equal(LIST_COMPOSED_TOOLS_TOOL.slug, 'list_composed_tools');
  });

  it('requires tool_collation', () => {
    assert.deepEqual(LIST_COMPOSED_TOOLS_TOOL.inputSchema.required, ['tool_collation']);
  });

  it('has a single fetch_request operation', () => {
    assert.equal(LIST_COMPOSED_TOOLS_TOOL.operations.length, 1);
    assert.equal(LIST_COMPOSED_TOOLS_TOOL.operations[0].type, 'fetch_request');
  });

  it('fetch_request URL filters by tool_collation', () => {
    const url = LIST_COMPOSED_TOOLS_TOOL.operations[0].config.url;
    assert.ok(url.includes('{{tool_collation}}'), 'URL should interpolate tool_collation');
    assert.ok(url.includes('filter'), 'URL should contain a filter');
  });
});

// ─── run_composed_tool ────────────────────────────────────────────────────────

describe('RUN_COMPOSED_TOOL_TOOL', () => {
  it('has slug run_composed_tool', () => {
    assert.equal(RUN_COMPOSED_TOOL_TOOL.slug, 'run_composed_tool');
  });

  it('requires tool_collation and tool_name', () => {
    assert.deepEqual(RUN_COMPOSED_TOOL_TOOL.inputSchema.required, ['tool_collation', 'tool_name']);
  });

  it('inputSchema includes an arguments property for the tool inputs', () => {
    assert.ok('arguments' in RUN_COMPOSED_TOOL_TOOL.inputSchema.properties);
  });

  it('has at least one operation (stub)', () => {
    assert.ok(RUN_COMPOSED_TOOL_TOOL.operations.length > 0);
  });
});

// ─── delete_composed_tool ─────────────────────────────────────────────────────

describe('DELETE_COMPOSED_TOOL_TOOL', () => {
  it('has slug delete_composed_tool', () => {
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.slug, 'delete_composed_tool');
  });

  it('requires tool_id and confirm', () => {
    assert.deepEqual(DELETE_COMPOSED_TOOL_TOOL.inputSchema.required, ['tool_id', 'confirm']);
  });

  it('has two operations: check_confirmation (run_script) then delete_tool (fetch_request)', () => {
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.operations.length, 2);
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.operations[0].slug, 'check_confirmation');
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.operations[0].type, 'run_script');
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.operations[1].slug, 'delete_tool');
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.operations[1].type, 'fetch_request');
  });

  it('check_confirmation resolves to delete_tool and has null reject', () => {
    const checkOp = DELETE_COMPOSED_TOOL_TOOL.operations[0];
    assert.equal(checkOp.resolve, 'delete_tool');
    assert.equal(checkOp.reject, null);
  });

  it('check_confirmation script throws when confirm is false', async () => {
    const checkOp = DELETE_COMPOSED_TOOL_TOOL.operations[0];
    await assert.rejects(
      () => runEmbeddedScript(checkOp, { tool_id: 5, confirm: false }),
      /Script failed/,
    );
  });

  it('check_confirmation script throws when confirm is absent', async () => {
    const checkOp = DELETE_COMPOSED_TOOL_TOOL.operations[0];
    await assert.rejects(
      () => runEmbeddedScript(checkOp, { tool_id: 5 }),
      /Script failed/,
    );
  });

  it('check_confirmation script returns the tool_id when confirm is true', async () => {
    const checkOp = DELETE_COMPOSED_TOOL_TOOL.operations[0];
    const result = await runEmbeddedScript(checkOp, { tool_id: 5, confirm: true });
    assert.equal(result, 5);
  });

  it('delete_tool uses DELETE method and interpolates tool_id in the URL', () => {
    const deleteOp = DELETE_COMPOSED_TOOL_TOOL.operations[1];
    assert.equal(deleteOp.config.method, 'DELETE');
    assert.ok(deleteOp.config.url.includes('{{tool_id}}'));
    assert.ok(deleteOp.config.url.includes('{{DIRECTUS_BASE_URL}}'));
  });
});
