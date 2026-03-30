import {JsonRpc_2_0 as specification, JsonRpc_2_0} from "../JsonRpc_2_0.mjs";

export function spec_implementation(req, res, next){
    // Attach the JsonRpc_2_0 utilities to the request object
    const response = new specification.Response(res);

    res.spec_data = (o) => response.data(o);
    res.spec_error = (o) => response.error(o);
    res.spec_without_data = (code) => response.without_data(code);

    next();
}