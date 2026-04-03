import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CallTool } from './CallTool.mjs';
import { clearFetchCache } from '../functions/fetch_cachable_data.mjs';
import { run_operations, get_fresh_vars } from '../functions/run_operations.mjs';

// Helper to build a mock fetch response
function makeResponse(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// A minimal Directus tools API response for a valid sub-tool
function makeToolsResponse(tool) {
  return makeResponse(200, { data: [tool] });
}

// A minimal tool object with a single run_script operation
function simpleTool(result) {
  return {
    name: 'target-tool',
    operations: [
      {
        slug: 'step-1',
        type: 'run_script',
        config: { code: `module.exports = async function(data) { return ${JSON.stringify(result)}; }` },
        resolve: null,
        reject: null,
      },
    ],
    start_slug: 'step-1',
  };
}

// Base context that satisfies CallTool's runtime requirements
const BASE_CONTEXT = {
  $env: {
    DIRECTUS_BASE_URL: 'https://directus.example.com',
  },
  $accountability: { id: 'user-123' },
  $vars: { isError: false },
  $last: null,
};

const BEARER_TOKEN = 'test-token';

// Create a CallTool instance with injected runtime dependencies
function makeOp(config) {
  const op = new CallTool(config);
  op.run_operations = run_operations;
  op.get_fresh_vars = get_fresh_vars;
  return op;
}

describe('CallTool', () => {
  // Clear the fetch cache before each test to prevent cache interference
  beforeEach(() => clearFetchCache());

  it('throws when run_operations is not injected', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_name: 'foo' });
    await assert.rejects(() => op.run(BASE_CONTEXT, BEARER_TOKEN), /run_operations.*not injected/i);
  });

  it('throws when get_fresh_vars is not injected', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_name: 'foo' });
    op.run_operations = run_operations;
    await assert.rejects(() => op.run(BASE_CONTEXT, BEARER_TOKEN), /get_fresh_vars.*not injected/i);
  });

  it('throws when DIRECTUS_BASE_URL is absent from context.$env', async () => {
    const op = makeOp({ tool_collation: 'col', tool_name: 'tool' });
    await assert.rejects(
      () => op.run({ $env: {} }, BEARER_TOKEN),
      /DIRECTUS_BASE_URL/
    );
  });

  it('throws when the target tool is not found in the collation', async () => {
    const op = makeOp({ tool_collation: 'col', tool_name: 'missing-tool' });

    const fetchMock = mock.fn(async () => makeResponse(200, { data: [] }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_CONTEXT, BEARER_TOKEN), /not found/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws on 401 from Directus', async () => {
    const op = makeOp({ tool_collation: 'col', tool_name: 'tool' });

    const fetchMock = mock.fn(async () => makeResponse(401, { errors: [] }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_CONTEXT, BEARER_TOKEN), /authorization failed/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws on non-2xx response from Directus', async () => {
    const op = makeOp({ tool_collation: 'col', tool_name: 'tool' });

    const fetchMock = mock.fn(async () => makeResponse(500, {}));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_CONTEXT, BEARER_TOKEN), /Directus returned 500/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('calls the target tool and returns its $last value', async () => {
    const op = makeOp({ tool_collation: 'col', tool_name: 'target-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool(42)));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run(BASE_CONTEXT, BEARER_TOKEN);
      assert.equal(result.$last, 42);
      assert.equal(result.$vars.isError, false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends the Authorization header to Directus using the explicitly passed bearer token', async () => {
    const op = makeOp({ tool_collation: 'col', tool_name: 'target-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool('ok')));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run(BASE_CONTEXT, BEARER_TOKEN);
      const [, options] = fetchMock.mock.calls[0].arguments;
      assert.equal(options.headers['Authorization'], 'Bearer test-token');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('fetches from the correct Directus URL with tool_collation filter', async () => {
    const op = makeOp({ tool_collation: 'my-collection', tool_name: 'target-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool('ok')));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run(BASE_CONTEXT, BEARER_TOKEN);
      const [url] = fetchMock.mock.calls[0].arguments;
      assert.ok(url.includes('/items/tools'));
      assert.ok(url.includes('my-collection'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('interpolates context values into tool_arguments before passing to the sub-tool', async () => {
    const tool = {
      name: 'echo-tool',
      slug: 'echo-tool',
      operations: [
        {
          slug: 'echo',
          type: 'run_script',
          config: {
            code: 'module.exports = async function(data) { return data.$trigger; }',
          },
          resolve: null,
          reject: null,
        },
      ],
      start_slug: 'echo',
    };

    const op = makeOp({
      tool_collation: 'col',
      tool_name: 'echo-tool',
      tool_arguments: { greeting: 'Hello {{name}}' },
    });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run({ ...BASE_CONTEXT, name: 'World' }, BEARER_TOKEN);
      assert.deepEqual(result.$last, { greeting: 'Hello World' });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('passes $accountability from the calling context to the sub-tool flow', async () => {
    const tool = {
      name: 'auth-tool',
      slug: 'auth-tool',
      operations: [
        {
          slug: 'capture',
          type: 'run_script',
          config: {
            code: 'module.exports = async function(data) { return data.$accountability; }',
          },
          resolve: null,
          reject: null,
        },
      ],
      start_slug: 'capture',
    };

    const op = makeOp({ tool_collation: 'col', tool_name: 'auth-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    const customAccountability = { id: 'user-abc', role: 'admin' };

    try {
      const result = await op.run({
        ...BASE_CONTEXT,
        $accountability: customAccountability,
      }, BEARER_TOKEN);
      assert.deepEqual(result.$last, customAccountability);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('passes $env from the calling context to the sub-tool flow (enabling nested CallTool)', async () => {
    const tool = {
      name: 'env-tool',
      slug: 'env-tool',
      operations: [
        {
          slug: 'read-env',
          type: 'run_script',
          config: {
            code: 'module.exports = async function(data) { return data.$env.CUSTOM_KEY; }',
          },
          resolve: null,
          reject: null,
        },
      ],
      start_slug: 'read-env',
    };

    const op = makeOp({ tool_collation: 'col', tool_name: 'env-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run({
        ...BASE_CONTEXT,
        $env: { ...BASE_CONTEXT.$env, CUSTOM_KEY: 'custom-value' },
      }, BEARER_TOKEN);
      assert.equal(result.$last, 'custom-value');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('parses config from a JSON string', async () => {
    const op = makeOp(
      JSON.stringify({ tool_collation: 'col', tool_name: 'target-tool' })
    );

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool('from-string-config')));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run(BASE_CONTEXT, BEARER_TOKEN);
      assert.equal(result.$last, 'from-string-config');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws for an invalid JSON string config', () => {
    assert.throws(() => new CallTool('{bad json'), /not valid JSON/i);
  });

  it('propagates errors thrown by the sub-tool flow', async () => {
    const tool = {
      name: 'failing-tool',
      slug: 'failing-tool',
      operations: [
        {
          slug: 'fail',
          type: 'run_script',
          config: {
            code: 'module.exports = async function(data) { throw new Error("sub-tool boom"); }',
          },
          resolve: null,
          reject: null,
        },
      ],
      start_slug: 'fail',
    };

    const op = makeOp({ tool_collation: 'col', tool_name: 'failing-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_CONTEXT, BEARER_TOKEN), /sub-tool boom/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
