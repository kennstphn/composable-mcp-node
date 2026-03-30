import express from 'express';
import Ajv from 'ajv';
import { run_operations } from './functions/run_operations.mjs';
import { initializeSchema, checkInitializationState } from './directus/schema.mjs';
import { DEFAULT_TOOLS } from './directus/default_tools.mjs';
import { setupPermissions } from './directus/permissions.mjs';
import {fetchToolsForCollation} from "./functions/get_tools_with_operations.mjs";
import { buildLandingPage } from './functions/buildLandingPage.mjs';

const ajv = new Ajv({ allErrors: true, coerceTypes: false });


/**
 * Extract the Bearer token from the Authorization header, or return null.
 */
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

async function loadAccountability(bearerToken, DIRECTUS_BASE_URL) {
  let url = new URL('/users/me', DIRECTUS_BASE_URL);
    url.searchParams.set('fields', '*,oauth.*');
  const response = await fetch(url,{
    headers:{
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    }
  });

  if(!response.ok){
    throw new Error(`Failed to fetch user info: ${response.status}`);
  }
  return response.json().then(r => r.data);
}

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
  }

  setupRoutes() {
    // Landing page
    this.app.get('/', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildLandingPage(this.DIRECTUS_BASE_URL));
    });

    // Initialization state check
    this.app.get('/initialize', async (req, res) => {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.json({ state: 'needed' });
      }

      try {
        const result = await checkInitializationState(this.DIRECTUS_BASE_URL, bearerToken);
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
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      // Check current state first; block early if migration is needed
      let currentState;
      try {
        currentState = await checkInitializationState(this.DIRECTUS_BASE_URL, bearerToken);
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
        results.schema      = await initializeSchema(this.DIRECTUS_BASE_URL, bearerToken);
        results.permissions  = await setupPermissions(this.DIRECTUS_BASE_URL, bearerToken);
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
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { list: true, call: true } },
            serverInfo: { name: 'composable-mcp', version: '0.1.0' },
          },
        });
      }

      if (method === 'notifications/initialized') {
        return res.status(204).end();
      }

      if (method === 'ping') {
        return res.json({ jsonrpc: '2.0', id, result: {} });
      }

      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      if (method === 'tools/list') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: DEFAULT_TOOLS.map(t => ({
              name: t.slug,
              description: t.description || '',
              inputSchema: t.inputSchema || { type: 'object', properties: {} },
            })),
          },
        });
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};

        // ── test_composed_tool: fetch tool from Directus and execute it ─────────
        if (name === 'test_composed_tool') {
          const { tool_collation, tool_name, arguments: toolArgs } = args || {};
          if (!tool_collation || !tool_name) {
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: 'tool_collation and tool_name are required' }],
                isError: true,
              },
            });
          }
          try {
            const collationTools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, bearerToken, tool_collation);
            const composedTool = collationTools.find(t => (t.slug || t.name) === tool_name);
            if (!composedTool) {
              return res.json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Tool "${tool_name}" not found in collation "${tool_collation}"` }],
                  isError: true,
                },
              });
            }
            const $accountability = await loadAccountability(bearerToken, this.DIRECTUS_BASE_URL);
            let result = await this.executeFlow(composedTool, { $trigger: toolArgs || {}, $accountability, $env: { DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL} }, bearerToken);
            result.$last_slug = result.$last.slug; // expose last operation slug for better debugging of composed tools
            delete(result.$last); // avoid redundancy in the main content

            return res.json({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
            });
          } catch (err) {
            console.error('test_composed_tool failed:', err);
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: err.message }],
                isError: true,
              },
            });
          }
        }

        const tool = DEFAULT_TOOLS.find(t => t.slug === name);

        if (!tool) {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Tool "${name}" not found` }],
              isError: true,
            },
          });
        }

        if (tool.inputSchema) {
          const validate = ajv.compile(tool.inputSchema);
          if (!validate(args || {})) {
            const messages = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`.trim()).join('; ');
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Invalid input: ${messages}` }],
                isError: true,
              },
            });
          }
        }

        try {
          const result = await this.executeFlow(tool, {
            ...(args || {}),
            // DIRECTUS_BASE_URL and DIRECTUS_TOKEN are injected so that
            // fetch_request operations can use {{DIRECTUS_BASE_URL}} and
            // {{DIRECTUS_TOKEN}} template interpolation.
            //
            // Security note: these keys are also technically visible to
            // run_script operations via the `data` argument.  This is
            // acceptable because default tools are filesystem-defined
            // (trusted server code), not user-supplied.  User-defined tools
            // served via POST /mcp/:tool_collation do NOT receive these keys.
            DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL,
            DIRECTUS_TOKEN: bearerToken,
          }, bearerToken);
          const lastValue = result.$last;
          const text = typeof lastValue === 'string'
            ? lastValue
            : JSON.stringify(lastValue, null, 2);

          return res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }] },
          });
        } catch (err) {
          console.error(`Default tool "${name}" failed:`, err);
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: err.message }],
              isError: true,
            },
          });
        }
      }

      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    });

    // MCP endpoint — per-request Directus fetch using the caller's Bearer token
    this.app.post('/mcp/:tool_collation', async (req, res) => {
      const { jsonrpc, id, method, params } = req.body || {};

      if (method === 'initialize') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
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
          },
        });
      }

      if (method === 'notifications/initialized') {
        return res.status(204).end();
      }

      if (method === 'ping') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {},
        });
      }

      const bearerToken = extractBearerToken(req);
      if ( !bearerToken ) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      const { tool_collation } = req.params;
      let tools;
      try {
        tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, bearerToken, tool_collation);
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }

      if (method === 'tools/list') {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.map(t => ({
              name: t.slug || t.name,
              description: t.description || '',
              inputSchema: t.inputSchema || { type: 'object', properties: {} },
            })),
          },
        });
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        const tool = tools.find(t => (t.slug || t.name) === name);

        if (!tool) {
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Tool "${name}" not found in collation "${tool_collation}"` }],
              isError: true,
            },
          });
        }

        if (tool.inputSchema) {
          const validate = ajv.compile(tool.inputSchema);
          if (!validate(args || {})) {
            const messages = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`.trim()).join('; ');
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Invalid input: ${messages}` }],
                isError: true,
              },
            });
          }
        }

        try {
          const $accountability = await loadAccountability(bearerToken, this.DIRECTUS_BASE_URL);
          const result = await this.executeFlow(tool, { $trigger: args, $accountability, $env: { DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL} }, bearerToken);
          const lastValue = result.$last;
          const text = typeof lastValue === 'string'
            ? lastValue
            : JSON.stringify(lastValue, null, 2);

          return res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }] },
          });
        } catch (err) {
          console.error(`Tool "${name}" failed:`, err);
          return res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: err.message }],
              isError: true,
            },
          });
        }
      }

      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    });

    // REST — list tools for a collation
    this.app.get('/rest/:tool_collation', async (req, res) => {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      const { tool_collation } = req.params;
      try {
        const tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, bearerToken, tool_collation);
        return res.json({
          tools: tools.map(t => ({
            name: t.slug || t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          })),
        });
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }
    });

    // REST — trigger a specific tool in a collation
    this.app.post('/rest/events/:tool_collation/:tool_name', async (req, res) => {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      const { tool_collation, tool_name } = req.params;
      const inputData = req.body || {};

      let tools;
      try {
        tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, bearerToken, tool_collation);
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }

      const tool = tools.find(t => (t.slug || t.name) === tool_name);
      if (!tool) {
        return res.status(404).json({
          content: [{ type: 'text', text: `Tool "${tool_name}" not found in collation "${tool_collation}"` }],
          isError: true,
        });
      }

      if (tool.inputSchema) {
        const validate = ajv.compile(tool.inputSchema);
        if (!validate(inputData)) {
          const messages = (validate.errors || []).map(e => `${e.instancePath} ${e.message}`.trim()).join('; ');
          return res.status(400).json({
            content: [{ type: 'text', text: `Invalid input: ${messages}` }],
            isError: true,
          });
        }
      }

      try {
        let $accountability = await loadAccountability( bearerToken, this.DIRECTUS_BASE_URL );
        const result = await this.executeFlow(tool, { $trigger: inputData, $accountability, $env: { DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL} }, bearerToken);
        const lastValue = result.$last;
        const text = typeof lastValue === 'string'
          ? lastValue
          : JSON.stringify(lastValue, null, 2);

        return res.json({
          content: [{ type: 'text', text }],
        });
      } catch (err) {
        console.error(`Tool "${tool_name}" failed:`, err);
        return res.status(500).json({
          content: [{ type: 'text', text: err.message }],
          isError: true,
        });
      }
    });
  }

  /**
   * Execute a flow using the iterative runtime
   */
  async executeFlow(flow, context, bearerToken) {
    return run_operations(flow.operations, flow.start_slug, context,bearerToken);
  }

  async listen() {
    return new Promise((resolve) => {
      this._server = this.app.listen(this.PORT, () => {
        console.log(`🚀 MCP Server running on http://localhost:${this.PORT}`);
        console.log(`   Landing page:  GET  /`);
        console.log(`   Init state:    GET  /initialize`);
        console.log(`   Health:        GET  /health`);
        console.log(`   Initialize:    POST /initialize`);
        console.log(`   MCP (default): POST /mcp`);
        console.log(`   MCP:           POST /mcp/{tool_collation}`);
        console.log(`   REST tools:    GET  /rest/{tool_collation}`);
        console.log(`   REST trigger:  POST /rest/events/{tool_collation}/{tool_name}`);
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
}
