# composable-mcp-node

A Node.js HTTP server that exposes **composed tools** as MCP (Model Context Protocol) endpoints. Tools are built by chaining operations together — each operation feeds its result into the next — so complex workflows can be assembled without writing a new server for every tool.

---

## What We're Building

An MCP server (HTTP transport, no SSE) where each "tool" is a named **flow**: an ordered chain of operations that accepts input, runs them in sequence, and returns a structured result. Tools are stored externally (currently Directus) and fetched per request using the caller's Bearer token, so new tools can be added or modified without redeploying the server.

### Core idea

```
POST /mcp/:tool_collation  { jsonrpc, method, params }
        │
        ▼
  fetch tools for collation (Directus)
        │
        ▼
  run operations in chain
  [op-1] ──resolve──▶ [op-2] ──resolve──▶ [op-3] ──▶ done
             └─reject──▶ [error-handler]
        │
        ▼
  return MCP content blocks
```

Each operation receives a shared **context** object and can read `$last` (the previous result), `$env` (frozen environment config), `$trigger` (caller-supplied input), and every earlier result keyed by its slug. On success it follows its `resolve` link; on error it follows `reject`.

---

## Current State

### What exists

| File | Status | Description |
|------|--------|-------------|
| `src/App.mjs` | ✅ working | Express server, Directus tool loader, MCP endpoints, landing page |
| `src/functions/run_operations.mjs` | ✅ working | Iterative flow runner with loop-guard and context tracking |
| `src/operations/ScriptOperation.mjs` | ✅ working | Runs user JS in a sandboxed `node:vm` context |
| `src/operations/FetchRequest.mjs` | ✅ working | Outbound HTTP calls with configurable method, headers, body |
| `src/operations/CallTool.mjs` | ✅ working | Calls another Directus-backed tool from within a flow |
| `src/directus/schema.mjs` | ✅ working | Ensures `tools` and `operations` collections exist in Directus |
| `src/directus/default_tools.mjs` | ✅ working | Built-in tool definitions served from the filesystem at `POST /mcp` |
| `src/directus/permissions.mjs` | ✅ working | Creates per-user CRUD permissions on tools/operations |
| `main.mjs` | ✅ working | Entry point |
| `package.json` | ✅ working | Dependencies declared (express, ajv) |

### Working pieces

- **Express HTTP server** — `GET /`, `GET /health`, `GET /initialize`, `POST /initialize`, `POST /mcp`, `POST /mcp/:tool_collation`
- **Default tools endpoint** — `POST /mcp` serves the 11 built-in management tools directly from the filesystem; no Directus round-trip for the tool list
- **Directus loader** — fetches user-defined tool definitions per request from a Directus collection at `POST /mcp/:tool_collation`
- **Iterative flow runner** — executes a chain of operations by slug, follows resolve/reject links, guards against infinite loops (max 50 visits per operation)
- **ScriptOperation** — lets a tool step run arbitrary JS; user code exports `async function(data) { ... }`
- **FetchRequest** — outbound HTTP calls with `{{key}}` template interpolation in URL, headers, and body; configurable method/headers/body
- **CallTool** — calls another Directus-backed tool from within a flow, propagating accountability and environment context
- **MCP tool listing** — `tools/list` returns MCP tool descriptors for the requested endpoint
- **Input validation** — validates request body against flow's `inputSchema` using AJV
- **MCP response format** — MCP endpoints return `{ content: [{ type: "text", text: "..." }] }`
- **Landing page** — `GET /` serves a dark-themed HTML page with a link to the Directus admin, an init-state badge, and a token form for running `POST /initialize` without leaving the browser
- **Initialization state check** — `GET /initialize` probes Directus and returns one of four states (see below); the Bearer token is optional — omitting it returns `{ state: "needed" }` immediately
- **Bootstrap endpoint** — `POST /initialize` creates Directus schema and sets up permissions in one call; blocked with `409` when state is `migration_needed` (migration is not supported)
- **Per-user permissions** — CRUD on `tools` and `operations` scoped to the item owner (`user_created = $CURRENT_USER`)
- **Unit tests** — 153 tests across `run_operations`, `ScriptOperation`, `FetchRequest`, `CallTool`, `default_tools`, and `App`

---

## Architecture

```
main.mjs
  └─ App.mjs  (Express + lifecycle)
       ├─ fetchToolsForCollation()  → fetches user-defined tool definitions per request
       ├─ GET  /                    → HTML landing page
       ├─ GET  /health
       ├─ GET  /initialize          → checkInitializationState() → src/directus/schema.mjs
       ├─ POST /initialize          → checkInitializationState() (blocks 409 if migration_needed)
       │    ├─ initializeSchema()    → src/directus/schema.mjs
       │    └─ setupPermissions()    → src/directus/permissions.mjs
       ├─ POST /mcp                 → DEFAULT_TOOLS (filesystem) → src/directus/default_tools.mjs
       ├─ POST /mcp/:tool_collation
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
| `$trigger` | object | Caller-supplied input arguments for the tool |
| `$env` | object (frozen) | Server environment config — includes `DIRECTUS_BASE_URL` |
| `$last` | any | Return value of the previous operation |
| `$vars` | object | Mutable accumulator, writable by operations |
| `[slug]` | any | Result of each completed operation, keyed by its slug |


### FetchRequest interpolation

`{{key}}` placeholders are resolved against the current context everywhere in the operation config — not just the URL:

| Config field | Interpolated? | Notes |
|---|---|---|
| `url` | ✅ | Always stringified |
| `headers.*` | ✅ | Each header value is interpolated |
| `body` (string) | ✅ | Embedded placeholders stringify; an exact `"{{key}}"` returns the raw value |
| `body` (object) | ✅ | All string leaf values are interpolated recursively |

When the entire value is a single placeholder (e.g., `"{{$last}}"`), the raw context value is returned as-is, preserving objects and arrays. This makes it easy to forward a previous operation's result directly as a request body.

---

## Default tools (`POST /mcp`)

The 11 built-in tools are served directly from the server's filesystem at `POST /mcp` — they are **not** stored in Directus and require no seeding step. Call them just like any other MCP endpoint:

```bash
# List all default tools
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

| Tool name | What it does |
|---|---|
| `list_operation_types` | Returns the operation types supported by this server (`run_script`, `fetch_request`, `call_tool`) |
| `create_tool` | Creates a new tool definition in Directus |
| `add_run_script_operation` | Adds a `run_script` operation step to an existing tool; accepts `tool_id`, `slug`, `code`, and optional `resolve`/`reject` |
| `add_fetch_request_operation` | Adds a `fetch_request` operation step to an existing tool; accepts `tool_id`, `slug`, `url`, and optional `method`, `headers`, `body`, `resolve`/`reject` |
| `edit_tool` | Updates fields on an existing tool (sparse PATCH) |
| `edit_run_script_operation` | Updates a `run_script` operation step (sparse PATCH); accepts `operation_id` and any of `slug`, `code`, `resolve`, `reject` |
| `edit_fetch_request_operation` | Updates a `fetch_request` operation step (sparse PATCH); accepts `operation_id` and any of `slug`, `url`, `method`, `headers`, `body`, `resolve`, `reject` |
| `list_collations` | Returns the distinct collation names (namespaces) that have tools stored in Directus |
| `list_composed_tools` | Returns the tools stored in Directus for a specified collation |
| `test_composed_tool` | Fetches a tool from Directus and executes it with the supplied arguments |
| `delete_composed_tool` | Permanently deletes a tool from Directus (requires explicit `confirm: true`) |

The add/edit operation tools are split by type so each has purpose-built input fields instead of a generic `type`+`config` pair. This means the MCP client can prompt more specifically — `code` for scripts, `url`/`method`/`headers`/`body` for HTTP calls.

## FetchRequest details
When a fetch_request operation runs, the server performs interpolation on the URL, headers, and body using the current context. 
This allows tools to dynamically construct requests based on previous operation results or caller input. Once the url is resolved, 
a check is made to see if the following conditions are met
- The url starts with the Directus base URL
- the headers DO NOT include an authorization header.

If both conditions are met, the server automatically injects an `Authorization Bearer <token>` header with the caller's token. 
This keeps tool calls to the backend authenticated. 

---

## Initialization state (`GET /initialize`)

The Bearer token is optional. If omitted the endpoint returns `{ "state": "needed" }` immediately without contacting Directus. Provide a token to probe the actual state:

```bash
curl http://localhost:8787/initialize \
  -H 'Authorization: Bearer <directus-token>'
# → { "state": "needed" | "in_progress" | "migration_needed" | "complete" }
# When state is migration_needed, a details object is also included:
# → { "state": "migration_needed", "details": { "missingToolFields": [...], "missingOpsFields": [...] } }
```

| State | Meaning |
|-------|---------|
| `needed` | Neither the `tools` nor the `operations` collection exists — fresh installation |
| `in_progress` | Collections exist but initialization is incomplete (missing fields or relation) |
| `migration_needed` | Collections exist but one or more expected fields are absent (app was updated) — **migration is not supported**; resolve the schema differences manually using the field names in `details` |
| `complete` | All collections, fields, and relations are in place |

---

## Landing page (`GET /`)

Navigating to the server root in a browser shows a setup dashboard:

![Landing page screenshot](https://github.com/user-attachments/assets/c7489934-2f84-4c45-bc88-829671b56430)

- **Open Directus Admin ↗** — a direct link to `DIRECTUS_BASE_URL/admin/`
- **Check Status** — calls `GET /initialize` with the entered token and updates the badge; when `migration_needed`, shows details about which fields are missing
- **Initialize** — calls `POST /initialize`; hidden once status is `complete` or `migration_needed`

---



### Performance
- [ ] Tool lists are visible & unique by authorization & collation index. Hash this for a (in memory? filesystem?) cached list and throttle rechecks to a configured # of seconds
- [ ] Earlier authorization noise rejection. Expose abusive ips to the host for watching/blocking
- [ ] Per-tool timeout and resource limits for script operations.

### Dev Ease
- [x] create a POST /initialize handler which checks for needed collections in directus and creates/updates them if needed
- [x] serve default tools from the filesystem at POST /mcp (no Directus seeding required)
- [x] Directus permissions for CRUD on tools / operations should be essentially "owned by this user"
- [x] GET /initialize — returns initialization state (`complete`, `in_progress`, `needed`, `migration_needed`)
- [x] GET / — HTML landing page with Directus link and initialization form

---

## Quick start

```bash
npm install
DIRECTUS_BASE_URL=https://your-directus.example.com \
NODE_ENV=development \
PORT=8787 \
npm start
```

```bash
# open the landing page in your browser
open http://localhost:8787/

# check initialization state (JSON) — token is optional; omit to get a quick "needed" check
curl http://localhost:8787/initialize \
  -H 'Authorization: Bearer <directus-token>'

# health check
curl http://localhost:8787/health

# bootstrap Directus schema + permissions (run once per Directus instance)
# note: default tools are filesystem-side and need no seeding
curl -X POST http://localhost:8787/initialize \
  -H 'Authorization: Bearer <directus-token>'

# list default tools (filesystem-side, no Directus lookup)
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# list tools in a user-defined collation (fetched from Directus)
curl -X POST http://localhost:8787/mcp/my-collation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# invoke a tool (MCP)
curl -X POST http://localhost:8787/mcp/my-collation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my-tool","arguments":{"input":"hello"}}}'

# create a new tool using the default tools at POST /mcp
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{ \
    "jsonrpc": "2.0", "id": 1, "method": "tools/call", \
    "params": { \
      "name": "create_tool", \
      "arguments": { \
        "name": "my-new-tool", \
        "title": "My New Tool", \
        "tool_collation": "my-collation", \
        "start_slug": "step-1" \
      } \
    } \
  }'

# add a run_script operation step to a tool (tool_id from create_tool response)
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{ \
    "jsonrpc": "2.0", "id": 2, "method": "tools/call", \
    "params": { \
      "name": "add_run_script_operation", \
      "arguments": { \
        "tool_id": 1, \
        "slug": "step-1", \
        "code": "module.exports = async function(data) { return { hello: data.$trigger.name }; };" \
      } \
    } \
  }'

# add a fetch_request operation step to a tool
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <directus-token>' \
  -d '{ \
    "jsonrpc": "2.0", "id": 3, "method": "tools/call", \
    "params": { \
      "name": "add_fetch_request_operation", \
      "arguments": { \
        "tool_id": 1, \
        "slug": "step-1", \
        "url": "https://api.example.com/items/{{$trigger.id}}", \
        "method": "GET", \
        "headers": { "Authorization": "Bearer {{$env.DIRECTUS_TOKEN}}" } \
      } \
    } \
  }'
```

---

## Tests

```bash
npm test
```

## Contributing

The project is in early development. The best way to help right now is to pick an item from the roadmap, open a PR, and include at least one test for the code you add.
