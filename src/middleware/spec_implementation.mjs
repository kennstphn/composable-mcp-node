export function spec_implementation(req, res, next){
    let {id} = req.body;
    // Attach the JsonRpc_2_0 utilities to the request object

    req.mcp = {
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
            res.json({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": err.code || -32000,
                    "message": err.message
                }
            })
        },
        empty_response(code){
            return res.send(code).end();
        }
    }

    next();
}