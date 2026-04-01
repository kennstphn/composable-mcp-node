import vm from 'node:vm';

export class ScriptOperation {
  constructor(config) {
    this.config = config; // { code: "the full user script code" }
    if(typeof config === 'string'){
        try{
            this.config = JSON.parse(config);
        }catch (err){
            throw new Error("ScriptOperation: config string is not valid JSON");
        }
    }
  }

  async run(context) {
    let { code } = this.config;
    if (!code) {
      throw new Error("ScriptOperation: 'code' property is required");
    }
    code = code.replaceAll(/\\n/g, '\n'); // Allow users to write \n in JSON strings for newlines

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

    let script;
    try{
      script = new vm.Script(wrappedCode);
    }catch (err){
      throw new Error("Script compilation error: " + err.message);
    }

    try{
      // Execute the script (this defines module.exports)
      script.runInContext(vmContext);
    }catch (err){
      throw new Error("Script execution error: " + err.message);
    }

    const userFunction = sandbox.module.exports;

    if (typeof userFunction !== 'function') {
      throw new Error("Script must export a function: module.exports = async function(data) {...}");
    }

    let result;
    try{
      // Call the user's function and await the result
      result = await userFunction(data);

    }catch (err){
      // If the thrown value has a string .message property (i.e. it is Error-like),
      // wrap it with a descriptive prefix so callers see a useful error string.
      // Otherwise (plain objects, primitives) re-throw the raw value unchanged so
      // that the run_operations engine can store it in $last and route via the
      // reject path – enabling throw-as-signal control flow between operations.
      if (err && typeof err.message === 'string') {
        throw new Error("Error from user function: " + err.message);
      }
      throw err;
    }

    // Return whatever the user returned (or empty object)
    return result !== undefined ? result : {};

  }
}
