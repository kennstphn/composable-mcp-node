import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOOLS,
  ADD_RUN_SCRIPT_OPERATION_TOOL,
  ADD_FETCH_REQUEST_OPERATION_TOOL,
  EDIT_RUN_SCRIPT_OPERATION_TOOL,
  EDIT_FETCH_REQUEST_OPERATION_TOOL,
} from './default_tools.mjs';
import { ScriptOperation } from '../operations/ScriptOperation.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run the embedded run_script code from an operation definition and return
 * the result, simulating how run_operations.mjs executes it.
 * The result is JSON-roundtripped to avoid cross-VM-realm object comparison
 * failures in assert.deepStrictEqual.
 */
async function runEmbeddedScript(operation, inputData) {
  const scriptOp = new ScriptOperation(operation.config);
  const result = await scriptOp.run({ ...inputData, $last: null, $env: {}, $vars: {} });
  return JSON.parse(JSON.stringify(result));
}

// ─── DEFAULT_TOOLS array ──────────────────────────────────────────────────────

describe('DEFAULT_TOOLS', () => {
  it('contains seven tools', () => {
    assert.equal(DEFAULT_TOOLS.length, 7);
  });

  it('includes the four new operation tools but not the old generic ones', () => {
    const slugs = DEFAULT_TOOLS.map(t => t.slug);
    assert.ok(slugs.includes('add_run_script_operation'));
    assert.ok(slugs.includes('add_fetch_request_operation'));
    assert.ok(slugs.includes('edit_run_script_operation'));
    assert.ok(slugs.includes('edit_fetch_request_operation'));
    assert.ok(!slugs.includes('add_operation'), 'old add_operation should be removed');
    assert.ok(!slugs.includes('edit_operation'), 'old edit_operation should be removed');
  });

  it('every tool has the required shape fields', () => {
    for (const tool of DEFAULT_TOOLS) {
      assert.ok(tool.slug,          `${tool.slug}: missing slug`);
      assert.ok(tool.name,          `${tool.slug}: missing name`);
      assert.ok(tool.tool_collation,`${tool.slug}: missing tool_collation`);
      assert.ok(tool.start_slug,    `${tool.slug}: missing start_slug`);
      assert.ok(Array.isArray(tool.operations), `${tool.slug}: operations must be an array`);
      assert.ok(tool.operations.length > 0,     `${tool.slug}: operations must not be empty`);
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
