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

// Base for all messages
const JSONRPC_VERSION = { type: 'string', const: '2.0' };

// 1. Request (including Notifications)
export const REQUEST_SCHEMA = {
    type: 'object',
    properties: {
        jsonrpc: JSONRPC_VERSION,
        method: { type: 'string', minLength: 1 },
        params: {
            type: ['object', 'array', 'null'],
            default: null   // or omit default if you prefer
        },
        id: {
            type: ['string', 'number', 'null']   // null is allowed but rare for real requests
        }
    },
    required: ['jsonrpc', 'method'],
    additionalProperties: false   // or true if you want to be lenient
};

// 2. Response (success or error)
export const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        jsonrpc: JSONRPC_VERSION,
        result: {},                     // any JSON value (including null)
        error: {
            type: 'object',
            properties: {
                code: { type: 'integer' },
                message: { type: 'string', minLength: 1 },
                data: {}                    // any value (often object or primitive)
            },
            required: ['code', 'message'],
            additionalProperties: false
        },
        id: {
            type: ['string', 'number', 'null']
        }
    },
    required: ['jsonrpc', 'id'],
    additionalProperties: false,
    // Important: exactly one of result or error must be present (not both)
    oneOf: [
        { required: ['result'] },
        { required: ['error'] }
    ]
};

export const MESSAGE_SCHEMA = {
oneOf: [
    REQUEST_SCHEMA,      // single request or notification
    RESPONSE_SCHEMA,     // single response
    {
        type: 'array',
        items: REQUEST_SCHEMA,   // batch of requests/notifications
        minItems: 1
    }
]
};
