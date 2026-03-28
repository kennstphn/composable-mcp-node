import vm from 'node:vm';

export class ScriptOperation {
  constructor(config) {
    this.config = config; // { code: "the full user script code" }
  }

  async run(context) {
    const { code } = this.config;

    if (!code) {
      throw new Error("ScriptOperation: 'code' property is required");
    }

    // Create the data object that gets passed to the user's function
    const data = {
      $last: context.$last,
      $env: context.$env,        // frozen
      $vars: context.$vars,       // mutable — this is your accumulator space
    };

    // Add every slug as a direct property for easy access
    // This replaces the old getSlug() idea
    for (const [slug, value] of Object.entries(context)) {
      if (!['$last', '$env', '$vars', '$error'].includes(slug)) {
        data[slug] = value;      // e.g. data.read_items, data.fetch_page, etc.
      }
    }

    // Optional: freeze $env and $last to prevent accidental mutation
    // (but leave $vars mutable)
    if (data.$env && typeof data.$env === 'object') Object.freeze(data.$env);
    if (data.$last && typeof data.$last === 'object') Object.freeze(data.$last);

    try {
      // Create a fresh VM context with the data object
      const sandbox = { data, module: {}, exports: {} };
      const vmContext = vm.createContext(sandbox);

      // Wrap the user's code so it properly defines module.exports
      const wrappedCode = `
        ${code}
        
        // If user forgot module.exports, provide a fallback
        if (typeof module.exports !== 'function') {
          module.exports = async function(data) { return {}; };
        }
      `;

      const script = new vm.Script(wrappedCode);

      // Execute the script (this defines module.exports)
      script.runInContext(vmContext);

      const userFunction = sandbox.module.exports;

      if (typeof userFunction !== 'function') {
        throw new Error("Script must export a function: module.exports = async function(data) {...}");
      }

      // Call the user's function and await the result
      const result = await userFunction(data);

      // Return whatever the user returned (or empty object)
      return result !== undefined ? result : {};

    } catch (err) {
      const scriptError = new Error(`Script failed: ${err.message}`);
      scriptError.original = err;
      throw scriptError;
    }
  }
}
