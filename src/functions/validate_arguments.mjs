import Ajv from "ajv";
const ajv = new Ajv({ allErrors: true, coerceTypes: false });

let compiled = new Map();

function get_validator(tool_name, inputSchema){

    // if we don't have a tool name, we can't cache the compiled validator, so we just compile and return it directly without caching
    if ( ! tool_name) return ajv.compile(inputSchema);

    // if we have a tool name, we can cache the compiled validator function in the "compiled" map
    // to avoid recompiling it on every invocation of the same tool
    if( ! compiled.has(tool_name)) compiled.set(tool_name, ajv.compile(inputSchema));

    // return the cached compiled validator function for this tool name
    return compiled.get(tool_name);

}
export function validate_arguments(inputSchema, args, tool_name = null){
    if(!inputSchema) return {isValid:true};

    // get the compiled validator function for this tool name and input schema
    let validate = get_validator(tool_name, inputSchema);

    // validate the arguments against the input schema using the compiled validator function
    validate(args)

    // if validation fails, return an object with isValid false and the validation errors;
    if(validate.errors){
        return {
            isValid:false,
            errors: validate.errors
        }
    }else{
        // if validation succeeds, return an object with isValid true and no errors
        return {
            isValid:true
            // errors should be undefined, not null or present at all, when validation succeeds
        }
    }

}