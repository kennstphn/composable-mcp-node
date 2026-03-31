import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run_operations } from './run_operations.mjs';

describe('run_operations', () => {
  it('executes a single run_script operation and returns $last', async () => {
    const operations = [
      {
        slug: 'step-1',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return 42; }' },
        resolve: null,
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'step-1');
    assert.equal(ctx.$last, 42);
    assert.equal(ctx['step-1'], 42);
  });

  it('threads $env into operations', async () => {
    const operations = [
      {
        slug: 'read-env',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return data.$env.FOO; }' },
        resolve: null,
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'read-env', {
      $env: { FOO: 'bar' },
    });
    assert.equal(ctx.$last, 'bar');
  });

  it('passes user input to operations', async () => {
    const operations = [
      {
        slug: 'echo',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return data.message; }' },
        resolve: null,
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'echo', {
      message: 'hello',
    });
    assert.equal(ctx.$last, 'hello');
  });

  it('follows the resolve chain', async () => {
    const operations = [
      {
        slug: 'step-1',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return 1; }' },
        resolve: 'step-2',
        reject: null,
      },
      {
        slug: 'step-2',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return data["step-1"] + 1; }' },
        resolve: null,
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'step-1');
    assert.equal(ctx['step-1'], 1);
    assert.equal(ctx['step-2'], 2);
    assert.equal(ctx.$last, 2);
  });

  it('follows the reject chain when an operation throws', async () => {
    const operations = [
      {
        slug: 'failing-step',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { throw new Error("boom"); }' },
        resolve: null,
        reject: 'error-handler',
      },
      {
        slug: 'error-handler',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return "recovered"; }' },
        resolve: null,
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'failing-step');
    assert.ok(ctx['failing-step'] instanceof Error);
    assert.match(ctx['failing-step'].message, /boom/);
    assert.equal(ctx['error-handler'], 'recovered');
    assert.equal(ctx.$last, 'recovered');
  });

  it('throws when a referenced slug does not exist', async () => {
    const operations = [
      {
        slug: 'step-1',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return 1; }' },
        resolve: 'nonexistent',
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'step-1');
    // The error is caught by the top-level try/catch and stored in $error
    assert.ok(ctx.$error instanceof Error);
    assert.match(ctx.$error.message, /Operation slug not found/);
  });

  it('detects infinite loops', async () => {
    const operations = [
      {
        slug: 'loop',
        type: 'run_script',
        config: { code: 'module.exports = async function(data) { return 1; }' },
        resolve: 'loop', // loops back to itself
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'loop');
    assert.ok(ctx.$error instanceof Error);
    assert.match(ctx.$error.message, /Infinite loop detected/);
  });

  it('throws for unknown operation types', async () => {
    const operations = [
      {
        slug: 'step-1',
        type: 'unknown_type',
        config: {},
        resolve: null,
        reject: null,
      },
    ];

    const ctx = await run_operations(operations, 'step-1');
    assert.ok(ctx.$error instanceof Error);
    assert.match(ctx.$error.message, /Unknown operation type/);
  });
});
