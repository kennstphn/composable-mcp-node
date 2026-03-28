export async function run_operations(operations, start_slug){
  // 1. Build operation index by slug
const opMap = {};
for (const op of operations) {
  opMap[op.slug] = op;
}

const context = {
  $env: Object.freeze({ ...initialEnv }),
  $last: null,
  vars: {},                    // still mutable for accumulators, tokens, flags, etc.
};

// Internal visit tracker (hidden from operations)
const visits = new Map();      // slug → visit count

const MAX_VISITS_PER_OP = 50;  // ← tune this based on your use case (pagination loops, etc.)

// Helper to safely increment and check visits
function checkAndIncrementVisit(slug) {
  const count = (visits.get(slug) || 0) + 1;
  visits.set(slug, count);

  if (count > MAX_VISITS_PER_OP) {
    throw new Error(`Infinite loop detected: Operation "${slug}" executed more than ${MAX_VISITS_PER_OP} times.`);
  }

  return count;
}

// Main execution (iterative version - safer than recursion for deep chains/loops)
async function executeFlow(start_slug) {
  let currentSlug = start_slug;

  while (currentSlug) {
    const op = opMap[currentSlug];
    if (!op) {
      throw new Error(`Operation slug not found: ${currentSlug}`);
    }

    // Track visits for loop/cycle protection
    checkAndIncrementVisit(currentSlug);

    try {
      const OpClass = operationTypes[op.type];
      const instance = new OpClass(op.config || {});

      const result = await instance.run(context);

      context[currentSlug] = result;
      context.$last = result;

      // Follow resolve chain on success
      currentSlug = op.resolve;

    } catch (err) {
      context[currentSlug] = {
        error: true,
        message: err.message,
        // add sanitized details if needed
      };
      context.$last = context[currentSlug];

      // Follow reject chain on failure
      currentSlug = op.reject;
    }
  }

  return context;
}

// Start the flow
try {
  await executeFlow(start_slug);   // e.g., the designated entry point slug
} catch (finalError) {
  console.error("Flow execution failed:", finalError);
  // You can attach the error to context if desired
  context.$error = finalError;
}

return context;
}
