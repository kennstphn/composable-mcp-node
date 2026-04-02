import express from 'express';
import expressWs from 'express-ws';
import Ajv from 'ajv';
import {get_fresh_vars, run_operations} from './functions/run_operations.mjs';
import {checkInitializationState, initializeSchema} from './directus/schema.mjs';
import {DEFAULT_TOOLS} from './directus/default_tools.mjs';
import {setupPermissions} from './directus/permissions.mjs';
import {fetchToolsForCollation} from "./functions/get_tools_with_operations.mjs";
const ajv = new Ajv({ allErrors: true, coerceTypes: false });
import {
    MethodNotFoundError,
    InvalidParamsError, MESSAGE_SCHEMA
} from "./JsonRpc_2_0.mjs";
import {extractBearerToken, skipAuthFor} from "./middleware/skipAuth.mjs";
import {accountability, loadAccountability} from "./middleware/accountability.mjs";
import {spec_implementation_middleware} from "./middleware/spec_implementation_middleware.mjs";
import {join} from 'path';
import {build_dist} from "./functions/build_dist.mjs";
import {CallTool} from "./operations/CallTool.mjs";


export class App {

  get PORT(){return this.env?.PORT};
  get DIRECTUS_BASE_URL(){return this.env?.DIRECTUS_BASE_URL};
  get NODE_ENV(){return this.env?.NODE_ENV};

  env = null;

  constructor(env) {
    const options = ['PORT', 'DIRECTUS_BASE_URL', 'NODE_ENV'];
    for (const name of options) {
      if (!Object.prototype.hasOwnProperty.call(env, name)) {
        throw new Error('missing app configuration: ' + name);
      }
    }
    this.env = env;
    this.env.toString = () =>  JSON.stringify(this.env);

    build_dist({$env: this.env})

    this.app = express();
    expressWs(this.app);
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    let {FORCE_HTTPS, TRUST_PROXY} = this.env;
    if (TRUST_PROXY) {
      this.app.set('trust proxy', TRUST_PROXY);
    }

    if (FORCE_HTTPS === 'true') {
      this.app.use((req, res, next) => {
        if (req.secure) {
          return next();
        }
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
      });
    }


    // provides "mcp" property on req with helper methods for generating MCP responses,
    // supporting the MCP protocol structure for /mcp routes
    this.app.use(spec_implementation_middleware);

    // Skip auth for public paths and for the unauthenticated MCP initialize handshake.
    // All other requests require a Bearer token (injected as req.token by this middleware).
    this.app.use(skipAuthFor(['/', '/health', '/initialize']));

    // Accountability middleware to enrich req with $accountability info based on the token's associated Directus user and roles.
    this.app.use(accountability(this.DIRECTUS_BASE_URL)); // best-effort: enriches req.$accountability

  }

  setupRoutes() {

    let prefix = this.env.ROUTES_PREFIX || '';
    this.app.use(prefix, express.static(join(import.meta.dirname,'../dist')))

    // Initialization state check
    this.app.get(prefix + '/initialize', async (req, res) => {

      try {
        const result = await checkInitializationState(this.DIRECTUS_BASE_URL, req.token);
        return res.json({
          state: result.state,
          ...(result.details ? { details: result.details } : {}),
        });
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          return res.status(err.status).json({ error: 'Directus authorization failed', state: 'needed' });
        }
        return res.status(500).json({ error: err.message, state: 'needed' });
      }
    });

    // Health check
    this.app.get(prefix + '/health', (req, res) => {
      res.json({
        status: 'ok',
        time: new Date().toISOString(),
        env: this.NODE_ENV,
      });
    });

    // Initialize — create Directus collections, seed default tools, set up permissions
    this.app.post(prefix + '/initialize', async (req, res) => {

      // POST /initialize always requires authentication (GET /initialize is public for probing).
      if (!req.token) {
        return res.status(401).json({ error: 'Authorization required', state: 'needed' });
      }

      // Check current state first; block early if migration is needed
      let currentState;
      try {
        currentState = await checkInitializationState(this.DIRECTUS_BASE_URL, req.token);
      } catch (err) {
        return res.status(err.status || 500).json({ ok: false, error: err.message });
      }

      if (currentState.state === 'migration_needed') {
        return res.status(409).json({
          ok: false,
          error: 'Migration is not supported. Please resolve the schema differences manually.',
          state: 'migration_needed',
          details: currentState.details,
        });
      }

      const results = {};
      try {
        results.schema      = await initializeSchema(this.DIRECTUS_BASE_URL, req.token);
        results.permissions  = await setupPermissions(this.DIRECTUS_BASE_URL, req.token);
        return res.json({ ok: true, ...results });
      } catch (err) {
        return res.status(err.status || 500).json({
          ok: false,
          error: err.message,
          ...results,
        });
      }
    });

    let mcpHandlerBound = this.mcp_http_handler.bind(this);
    this.app.post(prefix + '/mcp/:tool_collation', mcpHandlerBound);
    this.app.post(prefix + '/mcp', mcpHandlerBound);

    let wsHandlerBound = this.ws_handler.bind(this);
    this.app.ws(prefix + '/mcp/:tool_collation');
    this.app.ws(prefix + '/mcp', wsHandlerBound);


  }

  async listen() {
    return new Promise((resolve) => {
      this._server = this.app.listen(this.PORT, () => {
        console.log(`🚀 MCP Server running on http://localhost:${this.PORT}`);
        console.log(`   Landing page:       GET  /`);
        console.log(`   Init state:         GET  /initialize`);
        console.log(`   Health:             GET  /health`);
        console.log(`   Initialize:         POST /initialize`);
        console.log(`   MCP (default):      POST /mcp`);
        console.log(`   MCP:                POST /mcp/{tool_collation}`);
        console.log(`   WebSocket MCP:      ws   /mcp/{tool_collation}`);
        resolve(this._server);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this._server) {
        this._server.close((err) => (err ? reject(err) : resolve()));
      } else {
        resolve();
      }
    });
  }

  async mcp_http_handler(req, res) {
      const { method, params, id } = req.body || {};
      const { tool_collation } = req.params;

      let data = await this.handle_jsonrpc_2_request(method, params, id, tool_collation, req.token);
      if(!data) return res.status(204).send();
      // res with header application/json
      res.setHeader('Content-Type', 'application/json');
      return res.send(data);

  }

  user_websockets = new Map();
  async ws_handler(ws, req) {
      let token = extractBearerToken(req);
      let accountability = await loadAccountability(token,this.env.DIRECTUS_BASE_URL);
      let tool_collation = req.params?.tool_collation || null;

      if( ! accountability || ! accountability.id ){
          // close websocket. We don't allow anonymous access to the websocket, or lazy authentication after connection.
          return ws.close(1008, 'Unauthorized');
      }

      if ( ! this.user_websockets.has(accountability.id)) this.user_websockets.set(accountability.id, new Set());

      this.user_websockets.get(accountability.id).add(ws);

      // Error handler – for logging and early detection
      ws.on('error', (err) => {
          // Optional: Try to send one last error message to the client
          try {
              if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                      jsonrpc: "2.0",
                      error: { code: -32099, message: "Internal WebSocket error: " + err?.message },
                      id: null
                  }));
              }
          } catch (_) {}
      });

      // Close handler – the most important one for cleanup
      ws.on('close', (code, reason) => {
          this.user_websockets.get(accountability.id)?.delete(ws);
      });

      ws.on('message', async (message) => {
          let data;
          try{
              // parse the msg as json first
              data = JSON.parse(message);
          }catch (err){
              // if we fail to parse, send an error back to the client but keep the connection open
                return ws.send(JSON.stringify({
                    jsonrpc: "2.0",
                    error: { code: -32700, message: "Invalid JSON: " + err?.message },
                }));
          }

          let valid = this.message_validator(data);
          if(! valid){
              // if the message fails validation, send an error back to the client but keep the connection open
              return ws.send(JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32600, message: "Invalid message format", details: this.message_validator.errors },
                  id: data.id || null
              }));
          }

          if(Array.isArray(data)){
              if(data.length === 0) return; // ignore empty batch

              // batch, process in parallel and respond with an array of results
              let results = await Promise.all(data.map(d => this.handle_jsonrpc_2_request(d.method, d.params, d.id, tool_collation, token)));
              if( ws.readyState !== WebSocket.OPEN) return;
              ws.send(results);
          }else {
                // single request, process and respond
                let result = await this.handle_jsonrpc_2_request(data.method, data.params, data.id, tool_collation, token);
                if( ws.readyState !== WebSocket.OPEN) return;
                ws.send(result);
          }

      });

  }

  message_validator = ajv.compile(MESSAGE_SCHEMA);

  get cloned_environment(){
    return JSON.parse(JSON.stringify(this.env));
  }

  handle_jsonrpc_notification = async (method, params, tool_collation, token) => {
      console.info(`Received JSON-RPC notification: method=${method}, params=${JSON.stringify(params)}, tool_collation=${tool_collation}`);
      // todo as needed
  }

    /**
     * Handles a JSON-RPC 2.0 request and returns the appropriate response object as a string.
     *
     * @param method
     * @param params
     * @param id
     * @param tool_collation
     * @param token
     * @returns {Promise<string>}
     */
  handle_jsonrpc_2_request = async (method, params, id, tool_collation, token) => {
      // if id is missing, we can treat it as a notification and drop early without processing, since we won't be
      // sending a response back anyway. This is per the JSON-RPC 2.0 spec.
      if(id === undefined || id === null){

          // fire-and-forget notification handling (e.g. for client events that don't require a response, like "notifications/initialized")
          this.handle_jsonrpc_notification(...arguments);
          return; // no response for notifications
      }


      let $accountability = await loadAccountability(token, this.DIRECTUS_BASE_URL);
      let respond = (o)=>{
          return JSON.stringify({
              jsonrpc: "2.0",
              id,
              ...o
          });
      }

      if(method === 'ping'){
          return respond({ result: {} });
      }

      if (method === 'initialize') {
          return respond({
              result:{
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: { list: true, call: true } },
              },
              serverInfo: { name: 'composable-mcp', version: '0.1.0' },
              // instructions: 'custom instructions for the client implementation, if needed'
          });
      }


      if(method === 'tools/list'){
          try{
              let tools = tool_collation
                  ? await fetchToolsForCollation(this.DIRECTUS_BASE_URL, token, tool_collation)
                  : DEFAULT_TOOLS;

              return respond({
                  result:{
                      tools: tools.map(t => ({
                          name: t.name,
                          title: t.title,
                          description: t.description || '',
                          inputSchema: t.inputSchema || { type: 'object', properties: {} },
                      })),
                  }
              });
          }catch (err){
              return respond({
                  error: {
                      code: err.code || -32000,
                      message: err.message || 'Error fetching tools',
                      ...(err.status ? {httpStatus: err.status} : {})
                  }
              });
          }
      }

      if(method === 'tools/call'){
          let name = tool_collation ? `${tool_collation}__${params.name}` : params.name;
          let op = new CallTool({
              invocation:{
                  name: '{{$trigger.name}}',
                  arguments: '{{$trigger.arguments}}'
              },
          });
          op.run_operations = run_operations;
          op.get_fresh_vars = get_fresh_vars;

          try{
              // Collate the tool name with its collation if provided, using a double underscore as separator (e.g. "myCollation__myTool").

              let result = await op.run({
                  $env: this.cloned_environment, // protect the env from being overridden
                  $accountability: $accountability,
                  $trigger:{name, arguments: params} // the CallTool operation will use these to resolve the tool and its arguments when it runs.
                  // this keeps the interpolation and validation logic centralized in the CallTool operation, instead of having to duplicate it here in the handler.
                  // it also protects against double interpolation if we were to resolve the tool here and then pass it to the CallTool operation,
                  // which would also try to resolve it again when it runs.
              }, token)
              return respond({
                  result: {
                      content:[{type:"text",text: typeof result.$last === "string" ? result.$last :JSON.stringify(result.$last) }],
                      isError:result.$vars.isError || false
                  }
              });
          }catch (err){
              return respond({
                  error: {
                      code: err.code || -32000,
                      message: err.message || 'Error calling tool',
                      ...(err.status ? {httpStatus: err.status} : {})
                  }
              })
          }
      }

        // If we reach here, the method is not recognized
        return respond({
            error: {
                code: -32601,
                message: `Method not found: ${method}`
            }
        });
  };

}
