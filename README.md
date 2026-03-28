# composable-mcp-node

A Node.js HTTP server that exposes **composed tools** as MCP (Model Context Protocol) endpoints. Tools are built by chaining operations together — each operation feeds its result into the next — so complex workflows can be assembled without writing a new server for every tool.

---

## What We're Building

An MCP server (HTTP transport, no SSE) where each "tool" is a named **flow**: an ordered chain of operations that accepts input, runs them in sequence, and returns a structured result. Flows are stored externally (currently Directus) and loaded at startup, so new tools can be added or modified without redeploying the server.

### Core idea

```
POST /flows/:flowName  { ...inputs }
        │
        ▼
  load flow definition
        │
        ▼
  run operations in chain
  [op-1] ──resolve──▶ [op-2] ──resolve──▶ [op-3] ──▶ done
             └─reject──▶ [error-handler]
        │
        ▼
  return final context as JSON
```

Each operation receives a shared **context** object and can read `$last` (the previous result), `$env` (frozen environment config), and every earlier result keyed by its slug. On success it follows its `resolve` link; on error it follows `reject`.

---

## Current State

### What exists

| File | Status | Description |
|------|--------|-------------|
| `src/App.mjs` | ⚙️ mostly working | Express server, Directus flow loader, route scaffolding |
| `src/functions/run_operations.mjs` | ⚙️ mostly working | Iterative flow runner with loop-guard and context tracking |
| `src/operations/ScriptOperation.mjs` | ⚙️ mostly working | Runs user JS in a sandboxed `node:vm` context |
| `main.mjs` | ❌ syntax errors | Entry point — has typos that prevent startup |

### Working pieces

- **Express HTTP server** (`GET /health`, `POST /flows/:flowName`)
- **Directus loader** — fetches tool definitions from a Directus collection at startup
- **Iterative flow runner** — executes a chain of operations by slug, follows resolve/reject links, guards against infinite loops (max 50 visits per operation)
- **ScriptOperation** — lets a tool step run arbitrary JS; user code exports `async function(data) { ... }`

### Known gaps / bugs

- `main.mjs` has syntax errors (wrong punctuation in the config object)
- `App.executeFlow()` is stubbed — it doesn't call `run_operations` yet
- `run_operations.mjs` references `initialEnv` which is never passed in
- `FetchRequest` operation is imported but the file doesn't exist
- `ScriptOperation.mjs` mixes CommonJS `require()` with ES module syntax
- No `package.json` (dependencies not declared)
- No tests

---

## Architecture

```
main.mjs
  └─ App.mjs  (Express + lifecycle)
       ├─ loadFlowsFromDirectus()   → fetches flow definitions on startup
       ├─ GET  /health
       └─ POST /flows/:flowName
              └─ run_operations(operations, start_slug, env)
                    ├─ ScriptOperation   — sandboxed JS execution
                    └─ FetchRequest      — outbound HTTP calls  (planned)
```

### Operation schema (what Directus stores)

```json
{
  "slug": "get-weather",
  "type": "fetch_request",
  "config": { "url": "https://api.example.com/weather", "method": "GET" },
  "resolve": "format-output",
  "reject": "handle-error"
}
```

### Context object passed to every operation

| Key | Type | Notes |
|-----|------|-------|
| `$env` | object (frozen) | Server environment config |
| `$last` | any | Return value of the previous operation |
| `$vars` | object | Mutable accumulator, writable by operations |
| `[slug]` | any | Result of each completed operation, keyed by its slug |

---

## Roadmap

### v0.1 — Make it run
- [ ] Fix syntax errors in `main.mjs`
- [ ] Add `package.json` with `express` dependency
- [ ] Wire `App.executeFlow()` to call `run_operations`
- [ ] Fix `run_operations` signature to accept and thread `initialEnv`
- [ ] Fix `ScriptOperation` to use ES module `import` instead of `require`

### v0.2 — Complete core operations
- [ ] Implement `FetchRequest` operation (outbound HTTP with configurable method, headers, body)
- [ ] Decide on and document the full operation config schema
- [ ] Return a clean, predictable response shape from `POST /flows/:flowName`

### v0.3 — MCP protocol layer
- [ ] Add MCP tool-listing endpoint (`GET /tools` or per-spec equivalent)
- [ ] Map each loaded flow to an MCP `tool` descriptor (name, description, inputSchema)
- [ ] Validate incoming tool call arguments against the declared input schema
- [ ] Return MCP-conformant `content` blocks from tool calls

### v0.4 — Reliability & developer experience
- [ ] Add unit tests for `run_operations` and each operation type
- [ ] Add integration test for the full HTTP → flow → response path
- [ ] Structured logging (request ID, flow name, per-step timing)
- [ ] Graceful shutdown

### v0.5 — Tool management
- [ ] Hot-reload flows without restarting the server
- [ ] Support additional tool stores beyond Directus (file-based YAML/JSON as a fallback)
- [ ] Per-tool timeout and resource limits for script operations

---

## Quick start (once v0.1 is done)

```bash
npm install
DIRECTUS_BASE_URL=https://your-directus.example.com \
DIRECTUS_TOKEN=your-token \
NODE_ENV=development \
PORT=8787 \
node main.mjs
```

```bash
# health check
curl http://localhost:8787/health

# invoke a tool/flow
curl -X POST http://localhost:8787/flows/my-tool \
  -H 'Content-Type: application/json' \
  -d '{"input": "hello"}'
```

---

## Contributing

The project is in early development. The best way to help right now is to pick an item from the v0.1 or v0.2 roadmap, open a PR, and include at least one test for the code you add.
