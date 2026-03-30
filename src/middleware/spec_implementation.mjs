import {JsonRpc_2_0 as specification} from "../JsonRpc_2_0.mjs";

export function spec_implementation(req, res, next){
    let {id} = req.body;
    // Attach the JsonRpc_2_0 utilities to the request object
    const response = new specification.Response(res, id);

    res.spec_data = (o,isError) => response.data(o,isError);
    res.spec_error = (o) => response.error(o);
    res.spec_without_data = (code) => response.without_data(code);

    next();
}