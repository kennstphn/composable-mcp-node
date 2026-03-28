import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { App } from './App.mjs';

// ─── Shared mock tool data ────────────────────────────────────────────────────

const ECHO_TOOL = {
  slug: 'echo',
  name: 'Echo',
  description: 'Returns the input message',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  start_slug: 'run',
  operations: [
    {
      slug: 'run',
      type: 'run_script',
      config: { code: 'module.exports = async function(data) { return data.message; }' },
      resolve: null,
      reject: null,
    },
  ],
};

const SIMPLE_TOOL = {
  slug: 'greet',
  name: 'Greet',
  description: 'Returns a greeting',
  inputSchema: null,
  start_slug: 'step',
  operations: [
    {
      slug: 'step',
      type: 'run_script',
      config: { code: 'module.exports = async function() { return "hello"; }' },
      resolve: null,
      reject: null,
    },
  ],
};

// ─── Helpers: mock Directus responses ────────────────────────────────────────

function directusResponse(tools) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: tools }),
  };
}

function directusError(status) {
  return {
    ok: false,
    status,
    json: async () => ({ errors: [] }),
  };
}

/**
 * Wrap globalThis.fetch so calls to `directus.test` return a canned value
 * while all other calls (to the local Express server) go through normally.
 */
function mockDirectusFetch(handler) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async (url, options) => {
    if (url.includes('directus.test')) return handler(url, options);
    return origFetch(url, options);
  });
  return origFetch;
}

function restoreGlobalFetch(orig) {
  globalThis.fetch = orig;
}

// ─── App factory ─────────────────────────────────────────────────────────────

function makeApp() {
  return new App({
    PORT: 0, // let the OS assign a free port
    DIRECTUS_BASE_URL: 'https://directus.test',
    NODE_ENV: 'test',
  });
}

async function startApp(app) {
  const server = await app.listen();
  const { port } = server.address();
  return `http://localhost:${port}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('App', () => {

  // ─── GET /health ──────────────────────────────────────────────────────────

  describe('GET /health', () => {
    let app, base;
    before(async () => { app = makeApp(); base = await startApp(app); });
    after(() => app.close());

    it('returns status ok with env', async () => {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.env, 'test');
      assert.ok(body.time);
    });
  });

  // ─── POST /mcp/:tool_collation ────────────────────────────────────────────

  describe('POST /mcp/:tool_collation', () => {
    let app, base;
    before(async () => { app = makeApp(); base = await startApp(app); });
    after(() => app.close());

    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${base}/mcp/my-collation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.ok(body.error);
    });

    it('returns 401 when Authorization scheme is not Bearer', async () => {
      const res = await fetch(`${base}/mcp/my-collation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic dXNlcjpwYXNz',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      assert.equal(res.status, 401);
    });

    it('handles tools/list and returns MCP tool descriptors', async () => {
      const orig = mockDirectusFetch(() => directusResponse([SIMPLE_TOOL]));
      try {
        const res = await fetch(`${base}/mcp/my-collation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token-123',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.jsonrpc, '2.0');
        assert.equal(body.id, 1);
        assert.ok(Array.isArray(body.result.tools));
        assert.equal(body.result.tools[0].name, 'greet');
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('forwards the bearer token and correct filter to Directus', async () => {
      let capturedUrl, capturedHeaders;
      const orig = mockDirectusFetch((url, options) => {
        capturedUrl = url;
        capturedHeaders = options.headers;
        return directusResponse([]);
      });
      try {
        await fetch(`${base}/mcp/sales-tools`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer my-secret',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        assert.ok(capturedUrl.includes('filter%5Btool_collation%5D%5B_eq%5D=sales-tools'));
        assert.equal(capturedHeaders['Authorization'], 'Bearer my-secret');
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('handles tools/call and executes the matching tool', async () => {
      const orig = mockDirectusFetch(() => directusResponse([ECHO_TOOL]));
      try {
        const res = await fetch(`${base}/mcp/my-collation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'echo', arguments: { message: 'hi there' } },
          }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.jsonrpc, '2.0');
        assert.equal(body.id, 2);
        assert.equal(body.result.content[0].text, 'hi there');
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns isError in result when tools/call tool is not found', async () => {
      const orig = mockDirectusFetch(() => directusResponse([]));
      try {
        const res = await fetch(`${base}/mcp/my-collation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'nonexistent', arguments: {} },
          }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.result.isError, true);
        assert.ok(body.result.content[0].text.includes('nonexistent'));
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns 400 for an unknown JSON-RPC method', async () => {
      const orig = mockDirectusFetch(() => directusResponse([]));
      try {
        const res = await fetch(`${base}/mcp/my-collation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'unknown/method' }),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.ok(body.error);
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns the Directus error status when Directus rejects the token', async () => {
      const orig = mockDirectusFetch(() => directusError(401));
      try {
        const res = await fetch(`${base}/mcp/my-collation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer bad-token',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
        });
        assert.equal(res.status, 401);
      } finally {
        restoreGlobalFetch(orig);
      }
    });
  });

  // ─── GET /rest/:tool_collation ────────────────────────────────────────────

  describe('GET /rest/:tool_collation', () => {
    let app, base;
    before(async () => { app = makeApp(); base = await startApp(app); });
    after(() => app.close());

    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${base}/rest/my-collation`);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.ok(body.error);
    });

    it('returns tool descriptors for the collation', async () => {
      const orig = mockDirectusFetch(() => directusResponse([SIMPLE_TOOL, ECHO_TOOL]));
      try {
        const res = await fetch(`${base}/rest/my-collation`, {
          headers: { 'Authorization': 'Bearer test-token' },
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.tools));
        assert.equal(body.tools.length, 2);
        const names = body.tools.map(t => t.name);
        assert.ok(names.includes('greet'));
        assert.ok(names.includes('echo'));
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('forwards the correct filter and bearer token to Directus', async () => {
      let capturedUrl, capturedHeaders;
      const orig = mockDirectusFetch((url, options) => {
        capturedUrl = url;
        capturedHeaders = options.headers;
        return directusResponse([]);
      });
      try {
        await fetch(`${base}/rest/marketing`, {
          headers: { 'Authorization': 'Bearer my-token' },
        });
        assert.ok(capturedUrl.includes('filter%5Btool_collation%5D%5B_eq%5D=marketing'));
        assert.equal(capturedHeaders['Authorization'], 'Bearer my-token');
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns the Directus error status when Directus rejects the token', async () => {
      const orig = mockDirectusFetch(() => directusError(401));
      try {
        const res = await fetch(`${base}/rest/my-collation`, {
          headers: { 'Authorization': 'Bearer bad-token' },
        });
        assert.equal(res.status, 401);
      } finally {
        restoreGlobalFetch(orig);
      }
    });
  });

  // ─── POST /rest/events/:tool_collation/:tool_name ─────────────────────────

  describe('POST /rest/events/:tool_collation/:tool_name', () => {
    let app, base;
    before(async () => { app = makeApp(); base = await startApp(app); });
    after(() => app.close());

    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${base}/rest/events/my-collation/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.ok(body.error);
    });

    it('executes the named tool and returns MCP content', async () => {
      const orig = mockDirectusFetch(() => directusResponse([ECHO_TOOL]));
      try {
        const res = await fetch(`${base}/rest/events/my-collation/echo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({ message: 'world' }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.content));
        assert.equal(body.content[0].text, 'world');
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns 404 when the named tool is not in the collation', async () => {
      const orig = mockDirectusFetch(() => directusResponse([SIMPLE_TOOL]));
      try {
        const res = await fetch(`${base}/rest/events/my-collation/nonexistent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.isError, true);
        assert.ok(body.content[0].text.includes('nonexistent'));
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns 400 when input fails schema validation', async () => {
      const orig = mockDirectusFetch(() => directusResponse([ECHO_TOOL]));
      try {
        const res = await fetch(`${base}/rest/events/my-collation/echo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({}), // missing required "message"
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.isError, true);
        assert.ok(body.content[0].text.includes('Invalid input'));
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns the Directus error status when Directus rejects the token', async () => {
      const orig = mockDirectusFetch(() => directusError(403));
      try {
        const res = await fetch(`${base}/rest/events/my-collation/echo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer bad-token',
          },
          body: JSON.stringify({ message: 'hi' }),
        });
        assert.equal(res.status, 403);
      } finally {
        restoreGlobalFetch(orig);
      }
    });
  });

  // ─── App constructor ──────────────────────────────────────────────────────

  describe('App constructor', () => {
    it('throws when PORT is missing', () => {
      assert.throws(
        () => new App({ DIRECTUS_BASE_URL: 'https://x.test', NODE_ENV: 'test' }),
        /missing app configuration: PORT/,
      );
    });

    it('throws when DIRECTUS_BASE_URL is missing', () => {
      assert.throws(
        () => new App({ PORT: 8787, NODE_ENV: 'test' }),
        /missing app configuration: DIRECTUS_BASE_URL/,
      );
    });

    it('throws when NODE_ENV is missing', () => {
      assert.throws(
        () => new App({ PORT: 8787, DIRECTUS_BASE_URL: 'https://x.test' }),
        /missing app configuration: NODE_ENV/,
      );
    });

    it('does not require DIRECTUS_TOKEN', () => {
      assert.doesNotThrow(
        () => new App({ PORT: 8787, DIRECTUS_BASE_URL: 'https://x.test', NODE_ENV: 'test' }),
      );
    });
  });

  // ─── POST /initialize ─────────────────────────────────────────────────────

  describe('POST /initialize', () => {
    let app, base;
    before(async () => { app = makeApp(); base = await startApp(app); });
    after(() => app.close());

    it('returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${base}/initialize`, { method: 'POST' });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.ok(body.error);
    });

    it('returns ok:true and action summaries on success', async () => {
      // Stub all Directus schema / items / users endpoints
      const orig = mockDirectusFetch((url) => {
        // collections check → 404 (not found) so they will be created
        if (/\/collections\//.test(url)) {
          return { ok: false, status: 404, json: async () => ({ errors: [] }) };
        }
        // collection creation → 200
        if (/\/collections$/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: {} }) };
        }
        // relation check → 404, creation → 200
        if (/\/relations\//.test(url)) {
          return { ok: false, status: 404, json: async () => ({ errors: [] }) };
        }
        if (/\/relations$/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: {} }) };
        }
        // tools list for default seeding → empty
        if (/\/items\/tools/.test(url) && !url.includes('filter')) {
          return { ok: true, status: 200, json: async () => ({ data: [] }) };
        }
        if (/\/items\/tools/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: [] }) };
        }
        // tool creation → return a tool with an id
        if (/\/items\/tools$/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: { id: 1 } }) };
        }
        // operation creation → 200
        if (/\/items\/operations$/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: { id: 1 } }) };
        }
        // users/me → return a role
        if (/\/users\/me/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: { role: 'role-uuid-123' } }) };
        }
        // permissions list → empty
        if (/\/permissions/.test(url) && !url.includes('POST')) {
          return { ok: true, status: 200, json: async () => ({ data: [] }) };
        }
        // permissions creation → 200
        if (/\/permissions$/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ data: { id: 1 } }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: {} }) };
      });

      try {
        const res = await fetch(`${base}/initialize`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer init-token' },
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.ok(body.schema);
        assert.ok(body.defaultTools);
        assert.ok(body.permissions);
        assert.ok(Array.isArray(body.schema.actions));
        assert.ok(Array.isArray(body.defaultTools.actions));
        assert.ok(Array.isArray(body.permissions.actions));
      } finally {
        restoreGlobalFetch(orig);
      }
    });

    it('returns 500 and ok:false when Directus schema creation fails', async () => {
      const orig = mockDirectusFetch((url) => {
        // All Directus calls fail
        return { ok: false, status: 500, json: async () => ({ errors: [{ message: 'db error' }] }) };
      });

      try {
        const res = await fetch(`${base}/initialize`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer bad-token' },
        });
        assert.equal(res.status, 500);
        const body = await res.json();
        assert.equal(body.ok, false);
        assert.ok(body.error);
      } finally {
        restoreGlobalFetch(orig);
      }
    });
  });

  // ─── DIRECTUS_TOKEN in $env ───────────────────────────────────────────────

  describe('bearer token is available to tool operations via $env.DIRECTUS_TOKEN', () => {
    let app, base;
    before(async () => { app = makeApp(); base = await startApp(app); });
    after(() => app.close());

    it('exposes DIRECTUS_TOKEN in $env for MCP tool calls', async () => {
      let capturedEnv;
      const TOKEN_TOOL = {
        slug: 'read-token',
        name: 'Read Token',
        description: 'Returns the token from $env',
        inputSchema: null,
        start_slug: 'run',
        operations: [
          {
            slug: 'run',
            type: 'run_script',
            config: {
              code: 'module.exports = async function(data) { return data.$env.DIRECTUS_TOKEN; };',
            },
            resolve: null,
            reject: null,
          },
        ],
      };

      const orig = mockDirectusFetch(() => directusResponse([TOKEN_TOOL]));
      try {
        const res = await fetch(`${base}/mcp/my-collation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer user-bearer-token',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'read-token', arguments: {} },
          }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.result.content[0].text, 'user-bearer-token');
      } finally {
        restoreGlobalFetch(orig);
      }
    });
  });
});
