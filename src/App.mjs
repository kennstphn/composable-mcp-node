import express from 'express';
import Ajv from 'ajv';
import { run_operations } from './functions/run_operations.mjs';
import { initializeSchema, checkInitializationState } from './directus/schema.mjs';
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
  if(data){
    // we also need to parse the inputSchema for each tool's operations, if present
    for (const tool of data) {
        if(tool.inputSchema && typeof tool.inputSchema === 'string'){
            try {
                tool.inputSchema = JSON.parse(tool.inputSchema);
            } catch (e) {
                console.warn(`Failed to parse inputSchema for tool "${tool.slug || tool.name}":`, e);
                tool.inputSchema = { type: 'object', properties: {} };
            }
        }
    }
  }
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

/**
 * Generate the HTML landing page for a given Directus base URL.
 */
function buildLandingPage(directusBaseUrl) {
  const directusUrl = directusBaseUrl || '#';
  const directusAdminUrl = directusUrl.replace(/\/$/, '') + '/admin/';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Composable MCP</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 3rem 1rem;
    }
    .card {
      background: #1a1f2e;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 560px;
    }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem; }
    .subtitle { color: #94a3b8; font-size: 0.9rem; margin-bottom: 2rem; }
    .section { margin-bottom: 1.75rem; }
    .section-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin-bottom: 0.75rem;
    }
    a.directus-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: #6366f1;
      text-decoration: none;
      font-size: 0.9rem;
      padding: 0.5rem 0.875rem;
      border: 1px solid #6366f1;
      border-radius: 6px;
      transition: background 0.15s;
    }
    a.directus-link:hover { background: rgba(99,102,241,0.1); }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 0.3rem 0.7rem;
      border-radius: 999px;
      margin-bottom: 1rem;
    }
    .status-badge.complete       { background: rgba(16,185,129,0.15);  color: #10b981; }
    .status-badge.needed         { background: rgba(245,158,11,0.15);  color: #f59e0b; }
    .status-badge.in_progress    { background: rgba(59,130,246,0.15);  color: #3b82f6; }
    .status-badge.migration_needed { background: rgba(239,68,68,0.15); color: #ef4444; }
    .status-badge.unknown        { background: rgba(100,116,139,0.15); color: #64748b; }
    label { display: block; font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.4rem; }
    input[type="password"] {
      width: 100%;
      background: #0f1117;
      border: 1px solid #2d3748;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 0.9rem;
      padding: 0.55rem 0.75rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="password"]:focus { border-color: #6366f1; }
    .btn-row { display: flex; gap: 0.75rem; margin-top: 0.875rem; }
    button {
      padding: 0.5rem 1.1rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s;
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-secondary { background: #2d3748; color: #e2e8f0; }
    .btn-secondary:hover:not(:disabled) { background: #374151; }
    .btn-primary { background: #6366f1; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #4f46e5; }
    .result-box {
      margin-top: 1rem;
      background: #0f1117;
      border: 1px solid #2d3748;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-size: 0.82rem;
      color: #94a3b8;
      white-space: pre-wrap;
      display: none;
    }
    .result-box.error   { border-color: #ef4444; color: #ef4444; }
    .result-box.success { border-color: #10b981; color: #10b981; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Composable MCP</h1>
    <p class="subtitle">An HTTP server that exposes composed tools as MCP endpoints, powered by Directus.</p>

    <div class="section">
      <div class="section-title">Directus</div>
      <a class="directus-link" href="${directusAdminUrl}" target="_blank" rel="noopener noreferrer">
        Open Directus Admin &#x2197;
      </a>
    </div>

    <div class="section" id="init-section">
      <div class="section-title">Initialization</div>
      <div id="state-row">
        <span class="status-badge unknown" id="state-badge">&#x25cf; Unknown</span>
      </div>

      <label for="token-input">Directus Admin Token</label>
      <input type="password" id="token-input" placeholder="Paste your Directus admin token" autocomplete="off" />

      <div class="btn-row">
        <button class="btn-secondary" onclick="checkStatus()">Check Status</button>
        <button class="btn-primary hidden" id="init-btn" onclick="runInit()">Initialize</button>
      </div>
      <div class="result-box" id="result-box"></div>
    </div>
  </div>

  <script>
    var STATE_LABELS = {
      complete:          { label: '\u25cf Complete',         cls: 'complete' },
      in_progress:       { label: '\u25cf In progress',      cls: 'in_progress' },
      needed:            { label: '\u25cf Not initialized',  cls: 'needed' },
      migration_needed:  { label: '\u25cf Migration needed', cls: 'migration_needed' }
    };

    function setResult(text, type) {
      var el = document.getElementById('result-box');
      el.textContent = text;
      el.className = 'result-box' + (type ? ' ' + type : '');
      el.style.display = text ? 'block' : 'none';
    }

    function updateBadge(state) {
      var badge = document.getElementById('state-badge');
      var info = STATE_LABELS[state] || { label: '\u25cf Unknown', cls: 'unknown' };
      badge.textContent = info.label;
      badge.className = 'status-badge ' + info.cls;
      var initBtn = document.getElementById('init-btn');
      if (state === 'complete' || state === 'migration_needed') {
        initBtn.classList.add('hidden');
      } else {
        initBtn.classList.remove('hidden');
      }
    }

    async function checkStatus() {
      var token = document.getElementById('token-input').value.trim();
      if (!token) { setResult('Please enter a token first.', 'error'); return; }
      setResult('Checking\u2026', '');
      try {
        var res = await fetch('/initialize', { headers: { 'Authorization': 'Bearer ' + token } });
        var body = await res.json();
        if (!res.ok) { setResult('Error: ' + (body.error || res.status), 'error'); return; }
        updateBadge(body.state);
        if (body.state === 'migration_needed') {
          var lines = ['Migration is not supported. Please resolve the schema differences manually.'];
          if (body.details) {
            if (body.details.missingToolFields && body.details.missingToolFields.length) {
              lines.push('Missing tools fields: ' + body.details.missingToolFields.join(', '));
            }
            if (body.details.missingOpsFields && body.details.missingOpsFields.length) {
              lines.push('Missing operations fields: ' + body.details.missingOpsFields.join(', '));
            }
          }
          setResult(lines.join('\\n'), 'error');
        } else {
          setResult('', '');
        }
      } catch (e) {
        setResult('Request failed: ' + e.message, 'error');
      }
    }

    async function runInit() {
      var token = document.getElementById('token-input').value.trim();
      if (!token) { setResult('Please enter a token first.', 'error'); return; }
      var initBtn = document.getElementById('init-btn');
      initBtn.disabled = true;
      setResult('Initializing, please wait\u2026', '');
      try {
        var res = await fetch('/initialize', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        var body = await res.json();
        if (body.ok) {
          setResult('Initialization complete!', 'success');
          await checkStatus();
        } else {
          setResult('Error: ' + (body.error || 'Unknown error'), 'error');
        }
      } catch (e) {
        setResult('Request failed: ' + e.message, 'error');
      } finally {
        initBtn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
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
        console.log(`   Landing page:  GET  /`);
        console.log(`   Init state:    GET  /initialize`);
        console.log(`   Health:        GET  /health`);
        console.log(`   Initialize:    POST /initialize`);
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
