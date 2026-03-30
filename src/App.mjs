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

  PORT = '';
  DIRECTUS_BASE_URL = '';
  NODE_ENV = '';

  constructor(env) {
    const options = ['PORT', 'DIRECTUS_BASE_URL', 'NODE_ENV'];
    for (const name of options) {
      if (!Object.prototype.hasOwnProperty.call(env, name)) {
        throw new Error('missing app configuration: ' + name);
      }
      this[name] = env[name];
    }

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(skipAuthFor(['/', '/health'])); // injects "token" into req for non-skipped routes
    this.app.use(accountability(this.DIRECTUS_BASE_URL)); // injects "$accountability" into req for routes with a token

    this.app.use(spec_implementation);

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

    // Default tools — served from the filesystem, available at POST /mcp (no collation needed)
    this.app.post('/mcp', async (req, res) => {
      const { jsonrpc, id, method, params } = req.body || {};

      if (method === 'initialize') {
          return res.spec_data({
                protocolVersion: '2024-11-05',
                capabilities: { tools: { list: true, call: true } },
                serverInfo: { name: 'composable-mcp', version: '0.1.0' },
          })
      }

      if (method === 'notifications/initialized') {
        return res.spec_without_data(204);
      }

      if (method === 'ping') {
          return res.spec_data({});
      }


      if (method === 'tools/list') {
          return res.spec_data(this.default_tools);
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        const tool = DEFAULT_TOOLS.find(t => t.slug === name || t.name === name);

        if (!tool) {
            return res.spec_error(new InvalidParamsError(`Tool "${name}" not found`));
        }

        // ── test_composed_tool: fetch tool from Directus and execute it ─────────
        if (tool.slug === 'test_composed_tool') {
          const { tool_collation, tool_name, arguments: toolArgs } = args || {};
          if (!tool_collation || !tool_name) {
              return res.spec_error(new InvalidParamsError(`tool_collation and tool_name are required in arguments`))
          }
          try {
            const collationTools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, req.token, tool_collation);
            const composedTool = collationTools.find(t => t.slug === tool_name || t.name === tool_name);
            if (!composedTool) {
                return res.spec_error(new InvalidParamsError(`Tool "${tool_name}" not found in collation "${tool_collation}"`))
            }
            let run_result = await this.run_tool(composedTool, toolArgs, req);

            return res.spec_data(run_result.$last);

          } catch (err) {
              return res.spec_error(err);
          }
        }


        if (tool.inputSchema) {
          const validate = ajv.compile(tool.inputSchema);
          if (!validate(args || {})) {
            const messages = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`.trim()).join('; ');
            return res.spec_error( new InvalidParamsError(messages) );
          }
        }

        try {
          const result = await this.run_default_tool(tool, args || {}, req);
          return res.spec_data(result);
        } catch (err) {
            return res.spec_error(err);
        }
      }

      return res.spec_error(new MethodNotFoundError(`Method not found: ${method}`));
    });

    // MCP endpoint — per-request Directus fetch using the caller's Bearer token
    this.app.post('/mcp/:tool_collation', async (req, res) => {
      const { jsonrpc, id, method, params } = req.body || {};

      if (method === 'initialize') {
          return res.spec_data({
              protocolVersion: '2024-11-05',
              capabilities: {
                  tools: {
                      list: true,
                      call: true,
                  },
              },
              serverInfo: {
                  name: 'composable-mcp',
                  version: '0.1.0',
              },
          })
      }

      if (method === 'notifications/initialized') {
          return res.spec_without_data(204);
      }

      if (method === 'ping') {
          return res.spec_data({});
      }

      const { tool_collation } = req.params;
      let tools;
      try {
        tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, req.token, tool_collation);
      } catch (err) {
          return res.spec_error(err);
      }

      if (method === 'tools/list') {
          return res.spec_data({
              tools: tools.map(t => ({
                  name: t.slug || t.name,
                  description: t.description || '',
                  inputSchema: t.inputSchema || { type: 'object', properties: {} },
              })),
          });
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        const tool = tools.find(t => (t.slug || t.name) === name);

        try{
            let result = await this.run_tool(tool, args, req);
            return res.spec_data(result.$last);
        }catch (err){
            return res.spec_error(err);
        }
      }

      return res.spec_error(new MethodNotFoundError(`Method not found: ${method}`));
    });

    // REST — list tools for a collation
    this.app.get('/rest/b/:tool_collation', async (req, res) => {
        const { tool_collation } = req.params;
        try {
            const tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, req.token, tool_collation);
            return res.spec_data({
              tools: tools.map(t => ({
                name: t.slug || t.name,
                description: t.description || '',
                inputSchema: t.inputSchema || { type: 'object', properties: {} },
              }))
            });
        } catch (err) {
            return res.spec_error(err);
        }
    });

    // REST — trigger a specific tool in a collation
    this.app.post('/rest/b/events/:tool_collation/:tool_name', async (req, res) => {

      const { tool_collation, tool_name } = req.params;
      const inputData = req.body || {};
      try{
          let tool = await this.get_tools(req.token, tool_collation, tool_name);
          let result = await this.run_tool(tool, inputData,req)
          return res.spec_data(result.$last);
      }catch (err){
          return res.spec_error(err);
      }

    });

    this.app.get('/rest/compose', async (req, res) => {
        // list all tools available for composition.
        return res.spec_data(this.default_tools);
    });

    this.app.post('/rest/compose/events/:tool_name', async (req, res) => {
        const { tool_name } = req.params;
        const inputData = req.body || {};
        const tool = DEFAULT_TOOLS.find(t => t.slug === tool_name || t.name === tool_name);
        if (!tool) {
            return res.spec_error(new InvalidParamsError(`Tool "${tool_name}" not found`));
        }
        try {

            if(tool_name === 'test_composed_tool'){
                const { tool_collation, tool_name: composed_tool_name, arguments: toolArgs } = inputData || {};

                if (!tool_collation || !composed_tool_name) {
                    return res.spec_error(new InvalidParamsError(`tool_collation and tool_name are required in arguments`))
                }
                const collationTools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, req.token, tool_collation);
                const composedTool = collationTools.find(t => (t.slug || t.name) === composed_tool_name);
                if (!composedTool) {
                    return res.spec_error(new InvalidParamsError(`Tool "${composed_tool_name}" not found in collation "${tool_collation}"`));
                }

                let run_result = await this.run_tool(composedTool, toolArgs, req);

                return res.spec_data(run_result.$last);

            }

            let result = await this.run_default_tool(tool, inputData, req);
            return res.spec_data(result.$last);
        } catch (err) {
            return res.spec_error(err);
        }
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
        console.log(`   REST tools:         GET  /rest/b/{tool_collation}`);
        console.log(`   REST trigger:       POST /rest/b/events/{tool_collation}/{tool_name}`);
        console.log(`   REST build tools:   GET  /rest/compose`);
        console.log(`   REST build.trigger: POST /rest/compose/events/{tool_name}`);
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

  async get_tools(token, tool_collation,tool_name){
      let tools;
      tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, token, tool_collation);

      const tool = tools.find(t => (t.slug || t.name) === tool_name);
      if (!tool) {
          throw new InvalidParamsError(`Tool "${tool_name}" not found in collation "${tool_collation}"`);
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
          $env: {DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL}
      }, token);
  }

  async run_default_tool(tool, inputData, req){
      // we need to inject the directus data from the request to the inputData
      // so that it can be used in the operations of the default tool, for example, in fetch_request operations.
      // this is safe because default tools are defined in the filesystem by trusted server code, not user-supplied.
        return await this.run_tool(tool, {
            ...inputData,
            DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL,
            DIRECTUS_TOKEN: req.token,
        }, req);
  }

  get default_tools(){
      return {
          tools: DEFAULT_TOOLS.map(t => ({
              name: t.slug,
              description: t.description || '',
              inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })),
      };
  }

}
