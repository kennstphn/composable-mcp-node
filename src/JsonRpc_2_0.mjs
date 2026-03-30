export class JsonRpcError extends Error{
    code=-32000;
    data=null;
    constructor(message,code,data) {
        super(message);
        this.data = data;
        this.code = code;

    }

}
export class ParseError extends JsonRpcError{
    constructor(data) {
        super(-32700, 'Parse error', data);
    }
}

export class InvalidRequestError extends JsonRpcError{
    constructor(data) {
        super(-32600, 'Invalid Request', data);
    }
}

export class MethodNotFoundError extends JsonRpcError{
    constructor(data) {
        super(-32601, 'Method not found', data);
    }
}

export class InvalidParamsError extends JsonRpcError{
    constructor(data) {
        super(-32602, 'Invalid params', data);
    }
}

export class InternalError extends JsonRpcError{
    constructor(data) {
        super(-32603, 'Internal error', data);
    }
}

export class ServerError extends JsonRpcError{
    constructor(data,code) {
        super(code, 'Server error', data);
    }

}

export function respond_with_error(res, id, error){
    if(! error instanceof JsonRpcError){
        error = new ServerError(error instanceof Error ? error.message : String(error));
    }
    return res.json({
        jsonrpc: '2.0',
        id,
        error: {
            code: this.code,
            message: this.message,
            data: this.data
        }
    });
}

export function respond_with_data(res, id, data){
    return res.json({
        jsonrpc: '2.0',
        id,
        result: data
    });
}

export class Response{
    constructor(res, id){
        this.res = res;
        this.id = id;
    }

    error(error){
        return respond_with_error(this.res, this.id, error);
    }

    data(data){
        return respond_with_data(this.res, this.id, data);
    }

    without_data(code){
        return this.res.status( code).end();
    }
}

export const JsonRpc_2_0 = {
    ParseError,
    InvalidRequestError,
    MethodNotFoundError,
    InvalidParamsError,
    InternalError,
    ServerError,
    Response
}