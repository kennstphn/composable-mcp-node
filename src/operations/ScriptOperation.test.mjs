import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptOperation } from './ScriptOperation.mjs';

describe('ScriptOperation', () => {
  it('runs user code and returns the result', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { return 99; }',
    });
    const result = await op.run({ $env: {}, $last: null, $vars: {} });
    assert.equal(result, 99);
  });

  it('exposes $last from context to user code', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { return data.$last * 2; }',
    });
    const result = await op.run({ $env: {}, $last: 5, $vars: {} });
    assert.equal(result, 10);
  });

  it('exposes $env from context to user code', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { return data.$env.TOKEN; }',
    });
    const result = await op.run({ $env: Object.freeze({ TOKEN: 'secret' }), $last: null, $vars: {} });
    assert.equal(result, 'secret');
  });

  it('exposes $vars from context to user code', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { return data.$vars.count; }',
    });
    const result = await op.run({ $env: {}, $last: null, $vars: { count: 7 } });
    assert.equal(result, 7);
  });

  it('exposes previous slug results to user code', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { return data["step-one"]; }',
    });
    const result = await op.run({ $env: {}, $last: null, $vars: {}, 'step-one': 'hello' });
    assert.equal(result, 'hello');
  });

  it('throws when code is missing', async () => {
    const op = new ScriptOperation({});
    await assert.rejects(() => op.run({ $env: {}, $last: null, $vars: {} }), /code.*required/i);
  });

  it('throws a wrapped error when user code throws an Error', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { throw new Error("user error"); }',
    });
    await assert.rejects(() => op.run({ $env: {}, $last: null, $vars: {} }), /Error from user function/);
  });

  it('returns an empty object when user function returns undefined', async () => {
    const op = new ScriptOperation({
      code: 'module.exports = async function(data) { /* no return */ }',
    });
    const result = await op.run({ $env: {}, $last: null, $vars: {} });
    assert.deepEqual(result, {});
  });
});
