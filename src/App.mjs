import express from 'express';
import Ajv from 'ajv';
import {run_operations} from './functions/run_operations.mjs';
import {checkInitializationState, initializeSchema} from './directus/schema.mjs';
import {DEFAULT_TOOLS} from './directus/default_tools.mjs';
import {setupPermissions} from './directus/permissions.mjs';
import {fetchToolsForCollation} from "./functions/get_tools_with_operations.mjs";
import {buildLandingPage} from './functions/buildLandingPage.mjs';
const ajv = new Ajv({ allErrors: true, coerceTypes: false });
import {
    MethodNotFoundError,
    InvalidParamsError
} from "./JsonRpc_2_0.mjs";
import {skipAuthFor} from "./middleware/skipAuth.mjs";
import {accountability} from "./middleware/accountability.mjs";
import {spec_implementation} from "./middleware/spec_implementation.mjs";


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

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // provides "mcp" property on req with helper methods for generating MCP responses,
    // supporting the MCP protocol structure for /mcp routes
    this.app.use(spec_implementation);

    // Skip auth for public paths and for the unauthenticated MCP initialize handshake.
    // All other requests require a Bearer token (injected as req.token by this middleware).
    this.app.use(skipAuthFor(['/', '/health', '/initialize']));

    // Accountability middleware to enrich req with $accountability info based on the token's associated Directus user and roles.
    this.app.use(accountability(this.DIRECTUS_BASE_URL)); // best-effort: enriches req.$accountability



  }

  setupRoutes() {
    // Landing page
    this.app.get('/', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildLandingPage(this.DIRECTUS_BASE_URL));
    });

    // Initialization state check
    this.app.get('/initialize', async (req, res) => {

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
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        time: new Date().toISOString(),
        env: this.NODE_ENV,
      });
    });

    // Initialize — create Directus collections, seed default tools, set up permissions
    this.app.post('/initialize', async (req, res) => {

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

      this.app.post('/mcp/:tool_collation?', async (req, res) => {
          const { method, params } = req.body || {};
          const { tool_collation } = req.params;

          if (method === 'initialize') {
              return res.mcp.general_result({
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: { list: true, call: true } },
                  serverInfo: { name: 'composable-mcp', version: '0.1.0' },
              });
          }

          if (method === 'notifications/initialized') {
              return res.mcp.empty_response(204);
          }

          if (method === 'ping') {
              return res.mcp.general_result({});
          }

          // Resolve tools — either from Directus or built-in defaults
          let tools;
          try {
              tools = tool_collation
                  ? await fetchToolsForCollation(this.DIRECTUS_BASE_URL, req.token, tool_collation)
                  : DEFAULT_TOOLS;
          } catch (err) {
              return res.mcp.general_error(err);
          }

          if (method === 'tools/list') {
              return res.mcp.general_result({
                  tools: tools.map(t => ({
                      name: t.name,
                      title: t.title,
                      description: t.description || '',
                      inputSchema: t.inputSchema || { type: 'object', properties: {} },
                  })),
              });
          }

          if (method === 'tools/call') {
              const { name, arguments: args } = params || {};
              const tool = tools.find(t => t.name === name);

              if (!tool) {
                  return res.mcp.general_error(
                      new InvalidParamsError(
                          tool_collation
                              ? `Tool "${name}" not found in collation "${tool_collation}"`
                              : `Tool "${name}" not found`
                      )
                  );
              }

              if (tool.inputSchema) {
                  const validate = ajv.compile(tool.inputSchema);
                  if (!validate(args || {})) {
                      const messages = (validate.errors || [])
                          .map(e => `${e.instancePath} ${e.message}`.trim())
                          .join('; ');
                      return res.mcp.general_error(new InvalidParamsError(messages));
                  }
              }

              try {
                  const result = await this.run_tool(tool, args || {}, req);
                  return res.mcp.tool_call_result(result.$last, result.$vars.isError);
              } catch (err) {
                  return res.mcp.general_error(err);
              }
          }

          return res.mcp.general_error(new MethodNotFoundError(`Method not found: ${method}`));
      });


  }

  /**
   * Execute a flow using the iterative runtime
   */
  async executeFlow(flow, context, token) {
    return run_operations(flow.operations, flow.start_slug, context, token);
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

  async get_tools(token, tool_collation, tool_name){
      const tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, token, tool_collation);
      const tool = tools.find(t => t.name === tool_name);
      if (!tool) {
          const err = new InvalidParamsError(`Tool "${tool_name}" not found in collation "${tool_collation}"`);
          err.status = 404;
          throw err;
      }
      return tool;
  }

  async run_tool(tool, inputData,req) {
      let {token,$accountability} = req

      if (tool.inputSchema) {
          const validate = ajv.compile(tool.inputSchema);
          if (!validate(inputData)) {
              const messages = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`.trim()).join('; ');
              throw new InvalidParamsError(messages);
          }
      }

      return await this.executeFlow(tool, {
          $trigger: inputData,
          $accountability,
          $env: this.env,
      }, token);
  }

  get default_tools(){
      return {
          tools: DEFAULT_TOOLS.map(t => ({
              name: t.name,
              title: t.title,
              description: t.description || '',
              inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })),
      };
  }

}
