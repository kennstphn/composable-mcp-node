import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FetchRequest } from './FetchRequest.mjs';

// Helper to create a minimal mock Response
function makeResponse(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('FetchRequest', () => {
  it('throws when url is missing from config', async () => {
    const op = new FetchRequest({});
    await assert.rejects(() => op.run({}), /url.*required/i);
  });

  it('makes a GET request and returns parsed JSON', async () => {
    const op = new FetchRequest({
      url: 'https://example.com/api',
      method: 'GET',
    });

    const fetchMock = mock.fn(async () => makeResponse(200, { hello: 'world' }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run({});
      assert.deepEqual(result, { hello: 'world' });
      assert.equal(fetchMock.mock.calls.length, 1);
      const [url, options] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, 'https://example.com/api');
      assert.equal(options.method, 'GET');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends POST with JSON body and Content-Type header', async () => {
    const op = new FetchRequest({
      url: 'https://example.com/api',
      method: 'POST',
      body: { key: 'value' },
    });

    const fetchMock = mock.fn(async () => makeResponse(200, { ok: true }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run({});
      const [, options] = fetchMock.mock.calls[0].arguments;
      assert.equal(options.method, 'POST');
      assert.equal(options.body, '{"key":"value"}');
      assert.equal(options.headers['Content-Type'], 'application/json');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('does not add a body for GET requests', async () => {
    const op = new FetchRequest({
      url: 'https://example.com/api',
      method: 'GET',
      body: { should: 'be ignored' },
    });

    const fetchMock = mock.fn(async () => makeResponse(200, {}));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run({});
      const [, options] = fetchMock.mock.calls[0].arguments;
      assert.equal(options.body, undefined);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws on non-2xx responses', async () => {
    const op = new FetchRequest({ url: 'https://example.com/api' });

    const fetchMock = mock.fn(async () => makeResponse(404, { error: 'not found' }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await assert.rejects(() => op.run({}), /HTTP 404/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns raw text for non-JSON responses', async () => {
    const op = new FetchRequest({ url: 'https://example.com/text' });

    const fetchMock = mock.fn(async () => makeResponse(200, 'plain text', 'text/plain'));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const result = await op.run({});
      assert.equal(result, 'plain text');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('interpolates context values into the URL', async () => {
    const op = new FetchRequest({
      url: 'https://example.com/items/{{itemId}}',
      method: 'GET',
    });

    const fetchMock = mock.fn(async () => makeResponse(200, {}));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run({ itemId: '42' });
      const [url] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, 'https://example.com/items/42');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('merges caller-provided headers and does not override existing Content-Type (case-insensitive)', async () => {
    const op = new FetchRequest({
      url: 'https://example.com/api',
      method: 'POST',
      headers: { 'CONTENT-TYPE': 'application/x-www-form-urlencoded' },
      body: { foo: 'bar' },
    });

    const fetchMock = mock.fn(async () => makeResponse(200, {}));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await op.run({});
      const [, options] = fetchMock.mock.calls[0].arguments;
      // Should not add a second Content-Type when one already exists (different casing)
      const contentTypeKeys = Object.keys(options.headers)
        .filter(k => k.toLowerCase() === 'content-type');
      assert.equal(contentTypeKeys.length, 1);
      assert.equal(options.headers['CONTENT-TYPE'], 'application/x-www-form-urlencoded');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
