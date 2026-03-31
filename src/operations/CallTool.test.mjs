import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CallTool } from './CallTool.mjs';
import { clearFetchCache } from '../functions/fetch_cachable_data.mjs';

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
const BASE_ENV = {
  $env: {
    DIRECTUS_BASE_URL: 'https://directus.example.com',
    DIRECTUS_TOKEN: 'test-token',
  },
  $accountability: { id: 'user-123' },
};

describe('CallTool', () => {
  // Clear the fetch cache before each test to prevent cache interference
  beforeEach(() => clearFetchCache());

  it('throws when tool_collation is missing from config', async () => {
    const op = new CallTool({ tool_slug: 'foo' });
    await assert.rejects(() => op.run(BASE_ENV), /tool_collation.*required/i);
  });

  it('throws when tool_slug is missing from config', async () => {
    const op = new CallTool({ tool_collation: 'my-collection' });
    await assert.rejects(() => op.run(BASE_ENV), /tool_slug.*required/i);
  });

  it('throws when DIRECTUS_TOKEN is absent from context.$env', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'tool' });
    await assert.rejects(
      () => op.run({ $env: { DIRECTUS_BASE_URL: 'https://example.com' } }),
      /bearer token/i
    );
  });

  it('throws when DIRECTUS_BASE_URL is absent from context.$env', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'tool' });
    await assert.rejects(
      () => op.run({ $env: {} }, 'some-token'),
      /DIRECTUS_BASE_URL/
    );
  });

  it('throws when the target tool is not found in the collation', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'missing-tool' });

    const fetchMock = mock.fn(async () => makeResponse(200, { data: [] }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_ENV), /not found/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws on 401 from Directus', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'tool' });

    const fetchMock = mock.fn(async () => makeResponse(401, { errors: [] }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_ENV), /authorization failed/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws on non-2xx response from Directus', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'tool' });

    const fetchMock = mock.fn(async () => makeResponse(500, {}));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_ENV), /Directus returned 500/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('calls the target tool and returns its $last value', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'target-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool(42)));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run(BASE_ENV);
      assert.equal(result, 42);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends the Authorization header to Directus using the context token', async () => {
    const op = new CallTool({ tool_collation: 'col', tool_slug: 'target-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool('ok')));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run(BASE_ENV);
      const [, options] = fetchMock.mock.calls[0].arguments;
      assert.equal(options.headers['Authorization'], 'Bearer test-token');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('fetches from the correct Directus URL with tool_collation filter', async () => {
    const op = new CallTool({ tool_collation: 'my-collection', tool_slug: 'target-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool('ok')));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run(BASE_ENV);
      const [url] = fetchMock.mock.calls[0].arguments;
      assert.ok(url.includes('/items/tools'));
      assert.ok(url.includes('my-collection'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('interpolates context values into the input before passing to the sub-tool', async () => {
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

    const op = new CallTool({
      tool_collation: 'col',
      tool_slug: 'echo-tool',
      input: { greeting: 'Hello {{name}}' },
    });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run({ ...BASE_ENV, name: 'World' });
      assert.deepEqual(result, { greeting: 'Hello World' });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('passes $accountability from the calling context to the sub-tool flow', async () => {
    // The sub-tool's script exposes $accountability via $trigger so we can assert on it
    const accountabilityCapture = { value: null };
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

    const op = new CallTool({ tool_collation: 'col', tool_slug: 'auth-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    const customAccountability = { id: 'user-abc', role: 'admin' };

    try {
      const result = await op.run({
        ...BASE_ENV,
        $accountability: customAccountability,
      });
      assert.deepEqual(result, customAccountability);
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
            code: 'module.exports = async function(data) { return data.$env.DIRECTUS_TOKEN; }',
          },
          resolve: null,
          reject: null,
        },
      ],
      start_slug: 'read-env',
    };

    const op = new CallTool({ tool_collation: 'col', tool_slug: 'env-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run(BASE_ENV);
      assert.equal(result, 'test-token');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('parses config from a JSON string', async () => {
    const op = new CallTool(
      JSON.stringify({ tool_collation: 'col', tool_slug: 'target-tool' })
    );

    const fetchMock = mock.fn(async () => makeToolsResponse(simpleTool('from-string-config')));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run(BASE_ENV);
      assert.equal(result, 'from-string-config');
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

    const op = new CallTool({ tool_collation: 'col', tool_slug: 'failing-tool' });

    const fetchMock = mock.fn(async () => makeToolsResponse(tool));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run(BASE_ENV), /sub-tool boom/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
