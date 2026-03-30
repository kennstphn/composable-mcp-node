class JsonRpcError extends Error{
    code=-32000;
    data=null;
    constructor(message) {
        super(message);
    }

}
export class ParseError extends JsonRpcError{code=-32700;}

export class InvalidRequestError extends JsonRpcError{code=-32600;}

export class MethodNotFoundError extends JsonRpcError{code = -32601;}

export class InvalidParamsError extends JsonRpcError{code = -32602;}

export class InternalError extends JsonRpcError{code = -32603;}

export class ServerError extends JsonRpcError{
    code = -32000;
    constructor(data,code) {
        super(data instanceof Error ? data.message : String(data));
        this.code = code || this.code;
    }
}
