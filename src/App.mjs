import express from 'express';
import Ajv from 'ajv';
import { run_operations } from './functions/run_operations.mjs';

const ajv = new Ajv({ allErrors: true, coerceTypes: false });

export class App {

  PORT = '';
  DIRECTUS_BASE_URL = '';
  NODE_ENV = '';
  DIRECTUS_TOKEN = '';

  constructor(env) {
    const options = ['PORT', 'DIRECTUS_BASE_URL', 'NODE_ENV', 'DIRECTUS_TOKEN'];
    for (const name of options) {
      if (!Object.prototype.hasOwnProperty.call(env, name)) {
        throw new Error('missing app configuration: ' + name);
      }
      this[name] = env[name];
    }

    this.flows = new Map(); // name → flow definition (with start_slug + operations)

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

    // MCP tool listing — v0.3
    this.app.get('/tools', (req, res) => {
      const tools = [];
      for (const [name, flow] of this.flows) {
        tools.push({
          name,
          description: flow.description || '',
          inputSchema: flow.inputSchema || { type: 'object', properties: {} },
        });
      }
      res.json({ tools });
    });

    // Trigger a flow by name
    this.app.post('/flows/:flowName', async (req, res) => {
      const { flowName } = req.params;
      const inputData = req.body || {};

      const flow = this.flows.get(flowName);
      if (!flow) {
        return res.status(404).json({
          content: [{ type: 'text', text: `Flow "${flowName}" not found` }],
          isError: true,
        });
      }

      // Validate input against schema — v0.3
      if (flow.inputSchema) {
        const validate = ajv.compile(flow.inputSchema);
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
        });

        const result = await this.executeFlow(flow, inputData, env);

        // Return MCP-conformant content block — v0.3
        const lastValue = result.$last;
        const text = typeof lastValue === 'string'
          ? lastValue
          : JSON.stringify(lastValue, null, 2);

        res.json({
          content: [{ type: 'text', text }],
        });
      } catch (err) {
        console.error(`Flow "${flowName}" failed:`, err);
        res.status(500).json({
          content: [{ type: 'text', text: err.message }],
          isError: true,
        });
      }
    });
  }

  /**
   * Load all tools/flows from Directus on startup
   */
  async loadFlowsFromDirectus() {
    if (!this.DIRECTUS_BASE_URL) return;

    try {
      const url = new URL('/items/tools', this.DIRECTUS_BASE_URL);
      url.searchParams.set('fields', '*,operations.*');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.DIRECTUS_TOKEN || ''}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Directus returned ${response.status}`);
      }

      const { data } = await response.json();

      this.flows.clear();

      for (const tool of data || []) {
        if (tool.start_slug && Array.isArray(tool.operations)) {
          this.flows.set(tool.slug || tool.name, {
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || null,
            start_slug: tool.start_slug,
            operations: tool.operations,
          });

          console.log(`✓ Loaded flow: ${tool.name} (starts at ${tool.start_slug})`);
        }
      }

      console.log(`✅ Loaded ${this.flows.size} flows from Directus`);

    } catch (err) {
      console.error('Failed to load flows from Directus:', err.message);
      // Don't crash the app — flows can still be registered manually
    }
  }

  /**
   * Register a flow definition manually (useful for testing / local dev without Directus)
   */
  registerFlow(name, flow) {
    this.flows.set(name, flow);
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
    await this.loadFlowsFromDirectus();

    return new Promise((resolve) => {
      this._server = this.app.listen(this.PORT, () => {
        console.log(`🚀 MCP Server running on http://localhost:${this.PORT}`);
        console.log(`   Health:  GET  /health`);
        console.log(`   Tools:   GET  /tools`);
        console.log(`   Trigger: POST /flows/{flowName}`);
        console.log(`   Loaded flows: ${this.flows.size}`);
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
