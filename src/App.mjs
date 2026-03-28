import express from 'express';
import Ajv from 'ajv';
import { run_operations } from './functions/run_operations.mjs';
import { initializeSchema } from './directus/schema.mjs';
import { seedDefaultTools } from './directus/default_tools.mjs';
import { setupPermissions } from './directus/permissions.mjs';

const ajv = new Ajv({ allErrors: true, coerceTypes: false });

/**
 * Fetch tools from Directus for a specific tool_collation using the caller's bearer token.
 */
async function fetchToolsForCollation(baseUrl, bearerToken, toolCollation) {
  const url = new URL('/items/tools', baseUrl);
  url.searchParams.set('fields', '*,operations.*');
  url.searchParams.set('filter[tool_collation][_eq]', toolCollation);

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401 || response.status === 403) {
    const err = new Error('Directus authorization failed');
    err.status = response.status;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Directus returned ${response.status}`);
  }

  const { data } = await response.json();
  return data || [];
}

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

      const results = {};
      try {
        results.schema      = await initializeSchema(this.DIRECTUS_BASE_URL, bearerToken);
        results.defaultTools = await seedDefaultTools(this.DIRECTUS_BASE_URL, bearerToken);
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

    // MCP endpoint — per-request Directus fetch using the caller's Bearer token
    this.app.post('/mcp/:tool_collation', async (req, res) => {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }

      const { tool_collation } = req.params;
      let tools;
      try {
        tools = await fetchToolsForCollation(this.DIRECTUS_BASE_URL, bearerToken, tool_collation);
      } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
      }

      const { jsonrpc, id, method, params } = req.body || {};

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
          const env = Object.freeze({
            PORT: this.PORT,
            DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL,
            NODE_ENV: this.NODE_ENV,
            DIRECTUS_TOKEN: bearerToken,
          });

          const result = await this.executeFlow(tool, args || {}, env);
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
        const env = Object.freeze({
          PORT: this.PORT,
          DIRECTUS_BASE_URL: this.DIRECTUS_BASE_URL,
          NODE_ENV: this.NODE_ENV,
          DIRECTUS_TOKEN: bearerToken,
        });

        const result = await this.executeFlow(tool, inputData, env);
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
  async executeFlow(flow, inputData = {}, env = {}) {
    return run_operations(flow.operations, flow.start_slug, {
      $env: env,
      ...inputData,
    });
  }

  async listen() {
    return new Promise((resolve) => {
      this._server = this.app.listen(this.PORT, () => {
        console.log(`🚀 MCP Server running on http://localhost:${this.PORT}`);
        console.log(`   Health:       GET  /health`);
        console.log(`   Initialize:   POST /initialize`);
        console.log(`   MCP:          POST /mcp/{tool_collation}`);
        console.log(`   REST tools:   GET  /rest/{tool_collation}`);
        console.log(`   REST trigger: POST /rest/events/{tool_collation}/{tool_name}`);
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
