class JsonRpcError extends Error {
    code = -32000;
    data = null;
    constructor(message) {
        super(message);
    }

}
export class ParseError extends JsonRpcError{code=-32700;}

export class InvalidRequestError extends JsonRpcError { code = -32600; }

export class MethodNotFoundError extends JsonRpcError { code = -32601; }

export class InvalidParamsError extends JsonRpcError { code = -32602; }

export class InternalError extends JsonRpcError { code = -32603; }

export class ServerError extends JsonRpcError {
    code = -32000;
    constructor(data, code) {
        super(data instanceof Error ? data.message : String(data));
        this.code = code || this.code;
    }
}

// Base for all messages
const JSONRPC_VERSION = { type: 'string', const: '2.0' };

// Union type helper for id (string | number | null)
const ID_TYPE = {
    anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'null' }
    ]
};

// Union type helper for params (object | array | null)
const PARAMS_TYPE = {
    anyOf: [
        { type: 'object' },
        { type: 'array' },
        { type: 'null' }
    ]
};

// 1. Request (including Notifications)
export const REQUEST_SCHEMA = {
    type: 'object',
    properties: {
        jsonrpc: JSONRPC_VERSION,
        method: { type: 'string', minLength: 1 },
        params: PARAMS_TYPE,
        id: ID_TYPE
    },
    required: ['jsonrpc', 'method'],
    additionalProperties: false
};

// 2. Response (success or error)
export const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        jsonrpc: JSONRPC_VERSION,
        result: {},  // any JSON value (including null, primitives, objects, arrays)
        error: {
            type: 'object',
            properties: {
                code: { type: 'integer' },
                message: { type: 'string', minLength: 1 },
                data: {}  // any JSON value
            },
            required: ['code', 'message'],
            additionalProperties: false
        },
        id: ID_TYPE
    },
    required: ['jsonrpc', 'id'],
    additionalProperties: false,
    // Exactly one of result or error must be present (not both)
    oneOf: [
        { required: ['result'] },
        { required: ['error'] }
    ]
};

export const MESSAGE_SCHEMA = {
    oneOf: [
        REQUEST_SCHEMA,  // single request or notification
        RESPONSE_SCHEMA, // single response
        {
            type: 'array',
            items: REQUEST_SCHEMA, // batch of requests/notifications
            minItems: 1
        }
    ]
};