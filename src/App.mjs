import express from 'express';
import expressWs from 'express-ws';
import Ajv from 'ajv';
import {get_fresh_vars, run_operations} from './functions/run_operations.mjs';
import {checkInitializationState, initializeSchema} from './directus/schema.mjs';
import {DEFAULT_TOOLS} from './directus/default_tools.mjs';
import {setupPermissions} from './directus/permissions.mjs';
import {fetchToolsForCollation} from "./functions/get_tools_with_operations.mjs";
const ajv = new Ajv({ allErrors: true, coerceTypes: false });
import {MESSAGE_SCHEMA} from "./JsonRpc_2_0.mjs";
import {join} from 'path';
import {build_dist} from "./functions/build_dist.mjs";
import {CallTool} from "./operations/CallTool.mjs";
import {get_accountability, get_token} from "./functions/accountability.mjs";


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

  }

  setupRoutes() {

    let prefix = this.env.ROUTES_PREFIX || '';

    this.app.use(prefix, express.static(join(import.meta.dirname,'../dist')));

    // Initialization state check
    this.app.get(prefix + '/initialize', async (req, res) => {
        let accountability = await get_accountability(req,this.DIRECTUS_BASE_URL);

        if( ! accountability || ! accountability.id ){
            res.status(401).json({ error: 'Authorization required', state: 'needed' });
        }

        let token = get_token(req);

      try {
        const result = await checkInitializationState(this.DIRECTUS_BASE_URL, token);
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
        let accountability = await get_accountability(req,this.DIRECTUS_BASE_URL);

        // POST /initialize always requires authentication (GET /initialize is public for probing).
      if (!accountability || !accountability.id) {
        return res.status(401).json({ error: 'Authorization required', state: 'needed' });
      }

      let token = get_token(req);

      // Check current state first; block early if migration is needed
      let currentState;
      try {
        currentState = await checkInitializationState(this.DIRECTUS_BASE_URL, token);
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
        results.schema      = await initializeSchema(this.DIRECTUS_BASE_URL, token);
        results.permissions  = await setupPermissions(this.DIRECTUS_BASE_URL, token);
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
    this.app.ws(prefix + '/ws/:tool_collation');
    this.app.ws(prefix + '/ws', wsHandlerBound);


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
        console.log(`   MCP:                POST /mcp/:tool_collation?`);
        console.log(`   WebSocket MCP:      ws   /ws/:tool_collation?`);

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

      const token = get_token(req);

      const accountability = await get_accountability(req, this.DIRECTUS_BASE_URL);
      if ( ! accountability || ! accountability.id ){
            return res.status(401).json({ error: 'Unauthorized' });
      }

      let data = await this.handle_jsonrpc_2_request(method, params, id, tool_collation, token, accountability);
      if(!data) return res.status(204).send();
      // res with header application/json
      res.setHeader('Content-Type', 'application/json');
      return res.json(data);

  }

  user_websockets = new Map();
  async ws_handler(ws, req) {
      let token = get_token(req);
      let accountability = null;
      accountability = await get_accountability(req,this.env.DIRECTUS_BASE_URL);

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
          clearInterval(heartbeat_interval);
          this.user_websockets.get(accountability.id)?.delete(ws);
      });

      let close_timer;
      let restart_close_timer = () => {
            if (close_timer) clearTimeout(close_timer);
            close_timer = setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'Idle timeout');
                }
            }, 30 * 1000); // 5 minutes of idle time allowed
      };
      close_timer();


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

          // restart the idle timeout on every valid message.
          restart_close_timer();

          if(Array.isArray(data)){
              if(data.length === 0) return; // ignore empty batch

              // batch, process in parallel and respond with an array of results
              let results = await Promise.all(data.map(d => this.handle_jsonrpc_2_request(d.method, d.params, d.id, tool_collation, token, accountability)));
              if( ws.readyState !== WebSocket.OPEN) return;
              ws.send(JSON.stringify(results));
          }else {
                // single request, process and respond
                let result = await this.handle_jsonrpc_2_request(data.method, data.params, data.id, tool_collation, token, accountability);
                if( ws.readyState !== WebSocket.OPEN) return;
                ws.send(JSON.stringify(result));
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
     * Handles a JSON-RPC 2.0 request. If the "id" field is missing, treats it as a notification and processes it with
     * handle_jsonrpc_notification without sending a response.
     * @param method
     * @param params
     * @param id
     * @param tool_collation
     * @param token
     * @param $accountability
     * @returns {Promise<*&{jsonrpc: string, id}>}
     */
  handle_jsonrpc_2_request = async (method, params, id, tool_collation, token, $accountability) => {
      // if id is missing, we can treat it as a notification and drop early without processing, since we won't be
      // sending a response back anyway. This is per the JSON-RPC 2.0 spec.
      if(id === undefined || id === null){

          // fire-and-forget notification handling (e.g. for client events that don't require a response, like "notifications/initialized")
          this.handle_jsonrpc_notification(method,params, tool_collation, token)
          return; // no response for notifications
      }


      let respond = (o)=>{
          return {
              jsonrpc: "2.0",
              id,
              ...o
          };
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
