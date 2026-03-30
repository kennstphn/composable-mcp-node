import {ScriptOperation} from '../operations/ScriptOperation.mjs';
import {FetchRequest} from '../operations/FetchRequest.mjs';
import {CallTool} from '../operations/CallTool.mjs';

const operationTypes = {
  'run_script': ScriptOperation,
  'fetch_request': FetchRequest,
  'call_tool': CallTool,
};

/**
 * Run a chain of operations starting from start_slug.
 *
 * @param {Array}  operations    - Array of operation objects (slug, type, config, resolve, reject)
 * @param {string} start_slug    - Slug of the first operation to run
 * @param {object} initialContext - Seed context: should include $env (frozen), plus any initial
 *                                  input fields the operations may need. Keys that start with $
 *                                  are reserved ($env, $last, $vars, $error).
 * @returns {object} Final context after the chain completes
 */
export async function run_operations(operations, start_slug, initialContext = {}, bearerToken = null) {
  // 1. Build operation index by slug
  const opMap = {};
  for (const op of operations) {
    opMap[op.slug] = op;
  }

  // 2. Initialise context from provided seed
  const context = {
    $last: null,
    $vars: {
      isError:false // lets operations set this to true to indicate an error state for the tool response.
    },
    ...initialContext,
  };

  // Ensure $env is always a frozen object
  if (context.$env && typeof context.$env === 'object') {
    context.$env = Object.freeze({ ...context.$env });
  } else {
    context.$env = Object.freeze({});
  }

  // Internal visit tracker (hidden from operations)
  const visits = new Map();      // slug → visit count

  const MAX_VISITS_PER_OP = 50;  // tune based on use case (pagination loops, etc.)

  // Helper to safely increment and check visits
  function checkAndIncrementVisit(slug) {
    const count = (visits.get(slug) || 0) + 1;
    visits.set(slug, count);

    if (count > MAX_VISITS_PER_OP) {
      throw new Error(`Infinite loop detected: Operation "${slug}" executed more than ${MAX_VISITS_PER_OP} times.`);
    }

    return count;
  }

  // Main execution (iterative — safer than recursion for deep chains/loops)
  async function executeChain(startSlug) {
    let currentSlug = startSlug;

    while (currentSlug) {
      const op = opMap[currentSlug];
      if (!op) {
        throw new Error(`Operation slug not found: ${currentSlug}`);
      }

      // Track visits for loop/cycle protection
      checkAndIncrementVisit(currentSlug);

      const OpClass = operationTypes[op.type];
      if (!OpClass) {
        throw new Error(`Unknown operation type: "${op.type}"`);
      }

      const instance = new OpClass(op.config || {});

      let result = null;
      let is_error = false;
      try{
        result = await instance.run(context, bearerToken);
      }catch(err){
          is_error = true;
        result = err;
      }

      context[currentSlug] = result;
      context.$last = result;
      currentSlug = is_error ? (op.reject || null) : (op.resolve || null);

    }

    return context;

  }

  // Start the chain
  try {
    await executeChain(start_slug);
  } catch (finalError) {
    console.error('Flow execution failed:', finalError);
    context.$error = finalError;
  }

  return context;
}
