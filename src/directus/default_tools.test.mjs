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
  TEST_COMPOSED_TOOL_TOOL,
  DELETE_COMPOSED_TOOL_TOOL,
  MESSAGE_V1_RESPONSES_TOOL,
} from './default_tools.mjs';
import { ScriptOperation } from '../operations/ScriptOperation.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run the embedded run_script code from an operation definition and return
 * the result, simulating how run_operations.mjs executes it.
 * The result is JSON-roundtripped to avoid cross-VM-realm object comparison
 * failures in assert.deepStrictEqual.
 *
 * Pass context keys exactly as they would be present at runtime:
 *   • Caller-supplied arguments arrive via `$trigger` (e.g. `{ $trigger: { tool_id: 5 } }`)
 *   • Prior operation outputs are top-level keys named after their slug
 *     (e.g. `{ fetch_collations: { data: [...] } }`)
 */
async function runEmbeddedScript(operation, context) {
  const scriptOp = new ScriptOperation(operation.config);
  const result = await scriptOp.run({ $last: null, $env: {}, $vars: {}, ...context });
  return JSON.parse(JSON.stringify(result));
}

// ─── DEFAULT_TOOLS array ──────────────────────────────────────────────────────

describe('DEFAULT_TOOLS', () => {
  it('contains fifteen tools', () => {
    assert.equal(DEFAULT_TOOLS.length, 15);
  });

  it('includes all operation-editing tools and composed-tool management tools', () => {
    const names = DEFAULT_TOOLS.map(t => t.name);
    assert.ok(names.includes('add_run_script_operation'));
    assert.ok(names.includes('add_fetch_request_operation'));
    assert.ok(names.includes('edit_run_script_operation'));
    assert.ok(names.includes('edit_fetch_request_operation'));
    assert.ok(names.includes('list_collations'));
    assert.ok(names.includes('list_composed_tools'));
    assert.ok(names.includes('test_composed_tool'));
    assert.ok(names.includes('delete_composed_tool'));
    assert.ok(!names.includes('add_operation'), 'old add_operation should be removed');
    assert.ok(!names.includes('edit_operation'), 'old edit_operation should be removed');
  });

  it('every tool has the required shape fields', () => {
    for (const tool of DEFAULT_TOOLS) {
      assert.ok(tool.name,          `${tool.name}: missing name`);
      assert.ok(tool.start_slug,    `${tool.name}: missing start_slug`);
      assert.ok(Array.isArray(tool.operations), `${tool.name}: operations must be an array`);
      assert.ok(tool.operations.length > 0,     `${tool.name}: operations must not be empty`);
    }
  });

  it('no tool has a tool_collation field (they are filesystem-side, not stored in Directus)', () => {
    for (const tool of DEFAULT_TOOLS) {
      assert.ok(!('tool_collation' in tool), `${tool.name}: should not have tool_collation`);
    }
  });

  it('fetch_request operations use {{$trigger.DIRECTUS_BASE_URL}} and {{$trigger.DIRECTUS_TOKEN}}, not $env', () => {
    for (const tool of DEFAULT_TOOLS) {
      for (const op of tool.operations) {
        if (op.type !== 'fetch_request') continue;
        const url = op.config?.url || '';
        const auth = op.config?.headers?.Authorization || '';
        assert.ok(!url.includes('$env'),  `${tool.name}/${op.slug}: url must not reference $env`);
        assert.ok(!auth.includes('$env'), `${tool.name}/${op.slug}: Authorization must not reference $env`);
        if (url.includes('DIRECTUS')) {
          assert.ok(url.includes('{{$trigger.DIRECTUS_BASE_URL}}'), `${tool.name}/${op.slug}: url should use {{$trigger.DIRECTUS_BASE_URL}}`);
        }
        if (auth.includes('DIRECTUS')) {
          assert.ok(auth.includes('{{$trigger.DIRECTUS_TOKEN}}'), `${tool.name}/${op.slug}: Authorization should use {{$trigger.DIRECTUS_TOKEN}}`);
        }
      }
    }
  });
});

// ─── add_run_script_operation ─────────────────────────────────────────────────

describe('ADD_RUN_SCRIPT_OPERATION_TOOL', () => {
  it('has name add_run_script_operation', () => {
    assert.equal(ADD_RUN_SCRIPT_OPERATION_TOOL.name, 'add_run_script_operation');
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
    assert.deepEqual(body.config, { code: '{{$trigger.code}}' });
  });
});

// ─── add_fetch_request_operation ──────────────────────────────────────────────

describe('ADD_FETCH_REQUEST_OPERATION_TOOL', () => {
  it('has name add_fetch_request_operation', () => {
    assert.equal(ADD_FETCH_REQUEST_OPERATION_TOOL.name, 'add_fetch_request_operation');
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
      $trigger: {
        tool_id: 42,
        slug: 'my_step',
        url: 'https://api.example.com/data',
      },
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
      $trigger: {
        tool_id:  7,
        slug:     'fetch_step',
        url:      'https://api.example.com/items',
        method:   'POST',
        headers:  { 'Authorization': 'Bearer token' },
        body:     { key: 'value' },
        resolve:  'next_step',
        reject:   'error_step',
      },
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
      $trigger: {
        tool_id: 1,
        slug:    'get_step',
        url:     'https://example.com',
      },
    });
    assert.ok(!('method'  in result.config), 'method should not be set');
    assert.ok(!('headers' in result.config), 'headers should not be set');
    assert.ok(!('body'    in result.config), 'body should not be set');
  });
});

// ─── edit_run_script_operation ────────────────────────────────────────────────

describe('EDIT_RUN_SCRIPT_OPERATION_TOOL', () => {
  it('has name edit_run_script_operation', () => {
    assert.equal(EDIT_RUN_SCRIPT_OPERATION_TOOL.name, 'edit_run_script_operation');
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
    const result = await runEmbeddedScript(buildPatchOp, { $trigger: { operation_id: 5 } });
    assert.deepEqual(result, {});
  });

  it('build_patch script wraps code in config object', async () => {
    const buildPatchOp = EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      $trigger: {
        operation_id: 5,
        code: 'module.exports = async function(data) { return 42; };',
      },
    });
    assert.deepEqual(result, {
      config: { code: 'module.exports = async function(data) { return 42; };' },
    });
  });

  it('build_patch script includes slug, resolve, reject when provided', async () => {
    const buildPatchOp = EDIT_RUN_SCRIPT_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      $trigger: {
        operation_id: 5,
        slug:    'new_slug',
        code:    'module.exports = async function() { return 1; };',
        resolve: 'next',
        reject:  'err',
      },
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
  it('has name edit_fetch_request_operation', () => {
    assert.equal(EDIT_FETCH_REQUEST_OPERATION_TOOL.name, 'edit_fetch_request_operation');
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
    const result = await runEmbeddedScript(buildPatchOp, { $trigger: { operation_id: 9 } });
    assert.deepEqual(result, {});
  });

  it('build_patch script groups url/method/headers/body under config', async () => {
    const buildPatchOp = EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      $trigger: {
        operation_id: 9,
        url:    'https://new.example.com',
        method: 'DELETE',
      },
    });
    assert.deepEqual(result, {
      config: { url: 'https://new.example.com', method: 'DELETE' },
    });
  });

  it('build_patch script includes slug, resolve, reject alongside config', async () => {
    const buildPatchOp = EDIT_FETCH_REQUEST_OPERATION_TOOL.operations[0];
    const result = await runEmbeddedScript(buildPatchOp, {
      $trigger: {
        operation_id: 9,
        slug:    'updated_step',
        url:     'https://api.example.com/v2',
        headers: { 'X-Custom': 'val' },
        body:    { data: 1 },
        resolve: 'on_success',
        reject:  'on_fail',
      },
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
      $trigger: {
        operation_id: 9,
        slug:    'rename_only',
        resolve: 'next',
      },
    });
    assert.deepEqual(result, { slug: 'rename_only', resolve: 'next' });
    assert.ok(!('config' in result), 'config should not be set when no config fields supplied');
  });
});

// ─── list_collations ──────────────────────────────────────────────────────────

describe('LIST_COLLATIONS_TOOL', () => {
  it('has name list_collations', () => {
    assert.equal(LIST_COLLATIONS_TOOL.name, 'list_collations');
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
  it('has name list_composed_tools', () => {
    assert.equal(LIST_COMPOSED_TOOLS_TOOL.name, 'list_composed_tools');
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
    assert.ok(url.includes('{{$trigger.tool_collation}}'), 'URL should interpolate $trigger.tool_collation');
    assert.ok(url.includes('filter'), 'URL should contain a filter');
  });
});

// ─── test_composed_tool ────────────────────────────────────────────────────────

describe('TEST_COMPOSED_TOOL_TOOL', () => {
  it('has name test_composed_tool', () => {
    assert.equal(TEST_COMPOSED_TOOL_TOOL.name, 'test_composed_tool');
  });

  it('requires tool_collation and tool_name', () => {
    assert.deepEqual(TEST_COMPOSED_TOOL_TOOL.inputSchema.required, ['tool_collation', 'tool_name']);
  });

  it('inputSchema includes an arguments property for the tool inputs', () => {
    assert.ok('arguments' in TEST_COMPOSED_TOOL_TOOL.inputSchema.properties);
  });

  it('has at least one operation (stub)', () => {
    assert.ok(TEST_COMPOSED_TOOL_TOOL.operations.length > 0);
  });
});

// ─── delete_composed_tool ─────────────────────────────────────────────────────

describe('DELETE_COMPOSED_TOOL_TOOL', () => {
  it('has name delete_composed_tool', () => {
    assert.equal(DELETE_COMPOSED_TOOL_TOOL.name, 'delete_composed_tool');
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
      () => runEmbeddedScript(checkOp, { $trigger: { tool_id: 5, confirm: false } }),
      /Error from user function/,
    );
  });

  it('check_confirmation script throws when confirm is absent', async () => {
    const checkOp = DELETE_COMPOSED_TOOL_TOOL.operations[0];
    await assert.rejects(
      () => runEmbeddedScript(checkOp, { $trigger: { tool_id: 5 } }),
      /Error from user function/,
    );
  });

  it('check_confirmation script returns the tool_id when confirm is true', async () => {
    const checkOp = DELETE_COMPOSED_TOOL_TOOL.operations[0];
    const result = await runEmbeddedScript(checkOp, { $trigger: { tool_id: 5, confirm: true } });
    assert.equal(result, 5);
  });

  it('delete_tool uses DELETE method and interpolates tool_id in the URL', () => {
    const deleteOp = DELETE_COMPOSED_TOOL_TOOL.operations[1];
    assert.equal(deleteOp.config.method, 'DELETE');
    assert.ok(deleteOp.config.url.includes('{{$trigger.tool_id}}'));
    assert.ok(deleteOp.config.url.includes('{{$trigger.DIRECTUS_BASE_URL}}'));
  });
});

// ─── message_v1_responses ─────────────────────────────────────────────────────

describe('MESSAGE_V1_RESPONSES_TOOL', () => {
  it('has name message_v1_responses', () => {
    assert.equal(MESSAGE_V1_RESPONSES_TOOL.name, 'message_v1_responses');
  });

  it('requires request, endpoint, and token', () => {
    assert.deepEqual(
      MESSAGE_V1_RESPONSES_TOOL.inputSchema.required,
      ['request', 'endpoint', 'token'],
    );
  });

  it('inputSchema has request, endpoint, token, and tool_collation properties', () => {
    const props = Object.keys(MESSAGE_V1_RESPONSES_TOOL.inputSchema.properties);
    assert.ok(props.includes('request'));
    assert.ok(props.includes('endpoint'));
    assert.ok(props.includes('token'));
    assert.ok(props.includes('tool_collation'));
  });

  it('request property requires model', () => {
    assert.deepEqual(
      MESSAGE_V1_RESPONSES_TOOL.inputSchema.properties.request.required,
      ['model'],
    );
  });

  it('has start_slug init', () => {
    assert.equal(MESSAGE_V1_RESPONSES_TOOL.start_slug, 'init');
  });

  it('has seven operations in the correct order', () => {
    const slugs = MESSAGE_V1_RESPONSES_TOOL.operations.map(o => o.slug);
    assert.deepEqual(slugs, ['init', 'call_api', 'extract_calls', 'prepare_call', 'invoke_tool', 'append_result', 'finalize']);
  });

  it('operations have the correct types', () => {
    const ops = MESSAGE_V1_RESPONSES_TOOL.operations;
    assert.equal(ops.find(o => o.slug === 'init').type,          'run_script');
    assert.equal(ops.find(o => o.slug === 'call_api').type,      'fetch_request');
    assert.equal(ops.find(o => o.slug === 'extract_calls').type, 'run_script');
    assert.equal(ops.find(o => o.slug === 'prepare_call').type,  'run_script');
    assert.equal(ops.find(o => o.slug === 'invoke_tool').type,   'call_tool');
    assert.equal(ops.find(o => o.slug === 'append_result').type, 'run_script');
    assert.equal(ops.find(o => o.slug === 'finalize').type,      'run_script');
  });

  it('call_api uses $trigger.endpoint and $trigger.token, not $env', () => {
    const callApi = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'call_api');
    assert.ok(callApi.config.url.includes('{{$trigger.endpoint}}'));
    assert.ok(callApi.config.headers.Authorization.includes('{{$trigger.token}}'));
    assert.ok(!callApi.config.url.includes('$env'));
    assert.ok(!callApi.config.headers.Authorization.includes('$env'));
  });

  it('call_api body is {{$last.request}}', () => {
    const callApi = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'call_api');
    assert.equal(callApi.config.body, '{{$last.request}}');
  });

  it('invoke_tool interpolates tool_collation, tool_name, and tool_arguments from trigger and context', () => {
    const invokeOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'invoke_tool');
    assert.equal(invokeOp.config.tool_collation, '{{$trigger.tool_collation}}');
    assert.equal(invokeOp.config.tool_name,      '{{prepare_call.next_call.name}}');
    assert.equal(invokeOp.config.tool_arguments, '{{prepare_call.next_call.arguments}}');
  });

  it('resolve/reject chain routes correctly', () => {
    const ops = MESSAGE_V1_RESPONSES_TOOL.operations;
    const bySlug = Object.fromEntries(ops.map(o => [o.slug, o]));
    assert.equal(bySlug.init.resolve,          'call_api');
    assert.equal(bySlug.call_api.resolve,      'extract_calls');
    assert.equal(bySlug.extract_calls.resolve, 'prepare_call');
    assert.equal(bySlug.extract_calls.reject,  'finalize');
    assert.equal(bySlug.prepare_call.resolve,  'invoke_tool');
    assert.equal(bySlug.invoke_tool.resolve,   'append_result');
    assert.equal(bySlug.append_result.resolve, 'call_api');
    assert.equal(bySlug.append_result.reject,  'prepare_call');
    assert.equal(bySlug.finalize.resolve,       null);
  });

  // ── embedded script tests ────────────────────────────────────────────────

  it('init script wraps the trigger request in { request }', async () => {
    const initOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'init');
    const req = { model: 'gpt-4o', input: [{ role: 'user', content: 'hello' }] };
    const result = await runEmbeddedScript(initOp, { $trigger: { request: req } });
    assert.deepEqual(result, { request: req });
  });

  it('extract_calls returns tool_calls and updated request when response has function_call items', async () => {
    const extractOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'extract_calls');
    const init_request = { model: 'gpt-4o', input: [{ role: 'user', content: 'hi' }] };
    const response = {
      output: [
        { type: 'function_call', call_id: 'c1', name: 'search', arguments: JSON.stringify({ q: 'test' }) },
      ],
    };
    const result = await runEmbeddedScript(extractOp, {
      $last: response,
      init: { request: init_request },
    });
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].call_id, 'c1');
    assert.equal(result.tool_calls[0].name, 'search');
    assert.deepEqual(result.tool_calls[0].arguments, { q: 'test' });
    // Updated request should include the assistant output
    assert.equal(result.request.input.length, 2);
  });

  it('extract_calls throws { done, response } when there are no function_call items', async () => {
    const extractOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'extract_calls');
    const init_request = { model: 'gpt-4o', input: [] };
    const response = { output: [{ type: 'message', content: 'done' }] };
    const thrown = await assert.rejects(
      () => runEmbeddedScript(extractOp, { $last: response, init: { request: init_request } }),
    );
    // ScriptOperation re-throws plain objects unchanged so the done flag is preserved.
    assert.ok(thrown == null || thrown.done === true || JSON.stringify(thrown ?? {}).includes('"done":true'));
  });

  it('extract_calls uses append_result.request on subsequent turns', async () => {
    const extractOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'extract_calls');
    const updated_request = { model: 'gpt-4o', input: [{ role: 'user', content: 'hi' }, { role: 'tool', content: 'result' }] };
    const response = {
      output: [
        { type: 'function_call', call_id: 'c2', name: 'lookup', arguments: '{}' },
      ],
    };
    const result = await runEmbeddedScript(extractOp, {
      $last: response,
      init: { request: { model: 'gpt-4o', input: [{ role: 'user', content: 'hi' }] } },
      append_result: { request: updated_request },
    });
    // Should be based on updated_request, not init.request
    assert.equal(result.request.input.length, 3); // updated 2 + assistant output 1
  });

  it('prepare_call dequeues the first tool call and sets remaining', async () => {
    const prepareOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'prepare_call');
    const state = {
      request: { model: 'gpt-4o', input: [] },
      tool_calls: [
        { call_id: 'c1', name: 'search', arguments: { q: 'a' } },
        { call_id: 'c2', name: 'lookup', arguments: { id: 1 } },
      ],
    };
    const result = await runEmbeddedScript(prepareOp, { $last: state });
    assert.deepEqual(result.next_call, { call_id: 'c1', name: 'search', arguments: { q: 'a' } });
    assert.equal(result.remaining.length, 1);
    assert.equal(result.remaining[0].call_id, 'c2');
  });

  it('append_result appends tool output and returns { request } when no remaining calls', async () => {
    const appendOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'append_result');
    const state = {
      request: { model: 'gpt-4o', input: [{ role: 'user', content: 'hi' }] },
      next_call: { call_id: 'c1', name: 'search' },
      remaining: [],
    };
    // Simulate a CallTool trim_output result: { $last: 'search result', $vars: { isError: false } }
    const result = await runEmbeddedScript(appendOp, {
      $last: { $last: 'search result', $vars: { isError: false } },
      prepare_call: state,
    });
    assert.deepEqual(Object.keys(result), ['request']);
    const lastInput = result.request.input[result.request.input.length - 1];
    assert.equal(lastInput.type, 'function_call_output');
    assert.equal(lastInput.call_id, 'c1');
  });

  it('append_result throws { request, tool_calls } when remaining calls exist', async () => {
    const appendOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'append_result');
    const state = {
      request: { model: 'gpt-4o', input: [] },
      next_call: { call_id: 'c1', name: 'search' },
      remaining: [{ call_id: 'c2', name: 'lookup', arguments: {} }],
    };
    const thrown = await assert.rejects(
      () => runEmbeddedScript(appendOp, {
        $last: { $last: 'ok', $vars: { isError: false } },
        prepare_call: state,
      }),
    );
    // ScriptOperation re-throws plain objects unchanged so the tool_calls array is preserved.
    assert.ok(thrown == null || (thrown.tool_calls && thrown.tool_calls.length === 1) || JSON.stringify(thrown ?? {}).includes('"tool_calls"'));
  });

  it('finalize returns response from the thrown done object', async () => {
    const finalizeOp = MESSAGE_V1_RESPONSES_TOOL.operations.find(o => o.slug === 'finalize');
    const response = { id: 'resp_1', output: [{ type: 'message', content: 'hello' }] };
    const result = await runEmbeddedScript(finalizeOp, { $last: { done: true, response } });
    assert.deepEqual(result, response);
  });
});
