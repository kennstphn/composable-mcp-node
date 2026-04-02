export function spec_implementation_middleware(req, res, next){
    let id = req.body?.id || null;

    res.mcp = {
        general_result:(d) =>{
            return res.json({
                "jsonrpc": "2.0",
                "id": id,
                "result": d
            });
        },
        tool_call_result:(o,isError) => {
            return res.json({
                jsonrpc: '2.0',
                id,
                result: {
                    content:[{type:"text",text: typeof o === "string" ? o :JSON.stringify(o) }],
                    isError:isError || false
                }
            })
        },
        general_error:(err)=>{
            // Use err.status for HTTP status when set (e.g. Directus 401/403 errors);
            // fall back to 400 for JSON-RPC protocol errors (negative codes) and 500 otherwise.
            const httpStatus = err.status || (err.code < 0 ? 400 : 500);
            res.status(httpStatus).json({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": err.code || -32000,
                    "message": err.message
                }
            })
        },
        empty_response(code){
            return res.sendStatus(code);
        }
    }

    next();
}