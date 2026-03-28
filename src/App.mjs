import express from 'express';

export class App {

  PORT='';
  DIRECTUS_BASE_URL='';
  NODE_ENV = '';
  DIRECTUS_TOKEN = '';
  
  constructor(env) {
    let options = ['PORT', 'DIRECTUS_BASE_URL', 'NODE_ENV', 'DIRECTUS_TOKEN'];
    for(name of options){
      if( ! env.hasOwnProperty(name) ){
        throw new Error('missing app configuration: ' + name);
      }
      this[name] = env[name]
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
        env: this.env.NODE_ENV
      });
    });

    // Trigger a flow by name
    this.app.post('/flows/:flowName', async (req, res) => {
      const { flowName } = req.params;
      const inputData = req.body || {};

      const flow = this.flows.get(flowName);
      if (!flow) {
        return res.status(404).json({ error: `Flow "${flowName}" not found` });
      }

      try {
        const result = await this.executeFlow(flow, {
          ...inputData,
          $env: Object.freeze({ ...this.env }),
          request: {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: inputData
          }
        });

        res.json(result);
      } catch (err) {
        console.error(`Flow "${flowName}" failed:`, err);
        res.status(500).json({
          error: 'Flow execution failed',
          message: err.message
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
      url.searchParams.set('fields', '*,operations.*');   // This pulls nested operations

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.DIRECTUS_TOKEN || ''}`,
          'Content-Type': 'application/json'
        }
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
            start_slug: tool.start_slug,
            operations: tool.operations,   // array of ops with slug, type, config, resolve, reject, etc.
            // You can store other fields from the tool item here if needed
          });

          console.log(`✓ Loaded flow: ${tool.name} (starts at ${tool.start_slug})`);
        }
      }

      console.log(`✅ Loaded ${this.flows.size} flows from Directus`);

    } catch (err) {
      console.error('Failed to load flows from Directus:', err.message);
      // Don't crash the app — you can still register flows manually if needed
    }
  }

  /**
   * Execute a flow (you can move this to runtime.mjs later)
   */
  async executeFlow(flow, initialContext = {}) {
    // Reuse the runtime logic we built earlier
    // For now, placeholder – we'll flesh this out next if you want
    const context = {
      ...initialContext,
      $last: null,
      vars: {},
    };

    // TODO: Call your iterative runtime with flow.start_slug and flow.operations
    // const result = await runFlow(flow.start_slug, flow.operations, context);

    return context; // temporary
  }

  async listen() {
    await this.loadFlowsFromDirectus();

    this.app.listen(this.PORT, () => {
      console.log(`🚀 MCP Server running on http://localhost:${this.PORT}`);
      console.log(`   Health: GET /health`);
      console.log(`   Trigger: POST /flows/{flowName}`);
      console.log(`   Loaded flows: ${this.flows.size}`);
    });
  }

  close() {
    // If you need graceful shutdown later
  }
}
