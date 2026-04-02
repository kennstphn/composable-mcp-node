/**
 * Client-side chat application.
 *
 * Manages the WebSocket connection to /ws/chat, wraps JSON-RPC 2.0
 * message handling, and coordinates with ChatStorage for persistence.
 *
 * LLM invocation is performed server-side through the "chat" tool
 * collation.  Parameters follow the V1 responses API standard; only
 * the previous_response_id is persisted locally – not the full
 * conversation history.
 */

import { ChatStorage } from './ChatStorage.mjs';

export class ChatApp extends EventTarget {

    /** @type {ChatStorage} */
    storage;

    /** @type {WebSocket|null} */
    #ws = null;

    /** @type {Map<number, { resolve: Function, reject: Function }>} */
    #pending = new Map();

    /** @type {number} */
    #nextId = 1;

    /** @type {{ id: string, agent_id: string, previous_response_id: string|null }|null} */
    currentConversation = null;

    /** @type {{ id: string, name: string, model: string, endpoint: string, access_token: string }|null} */
    currentAgent = null;

    constructor(env) {
        super();
        this.env = env;
        this.storage = new ChatStorage(env);
        // heartbeat to keep alive connections
        setInterval(() => {
            if (this.connected) {
                this.#ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
            }
        },20 * 1000)
    }

    // ── Connection ──────────────────────────────────────────────────────────

    /**
     * Open a WebSocket connection. Authentication is handled by the browser
     * automatically via the Directus session cookie set at login.
     */
    connect() {
        if (this.#ws) this.disconnect();

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const url   = `${proto}://${location.host}${this.env.ROUTES_PREFIX}/ws/chat`;

        this.#ws = new WebSocket(url);
        this.#ws.addEventListener('open',    ()  => this.dispatchEvent(new Event('connected')));
        this.#ws.addEventListener('close',   (e) => this._onClose(e));
        this.#ws.addEventListener('error',   (e) => this.dispatchEvent(new CustomEvent('ws-error', { detail: e })));
        this.#ws.addEventListener('message', (e) => this._onMessage(e));
    }

    disconnect() {
        // Reject any outstanding RPC calls
        this.#pending.forEach(({ reject }) => reject(new Error('WebSocket closed')));
        this.#pending.clear();
        this.#ws?.close(1000, 'User disconnected');
        this.#ws = null;
    }

    /** @returns {boolean} */
    get connected() {
        return this.#ws?.readyState === WebSocket.OPEN;
    }

    // ── Internal WebSocket handlers ─────────────────────────────────────────

    _onClose(event) {
        this.#pending.forEach(({ reject }) => reject(new Error('WebSocket closed')));
        this.#pending.clear();
        this.#ws = null;
        this.dispatchEvent(new CustomEvent('disconnected', { detail: { code: event.code, reason: event.reason } }));
    }

    _onMessage(event) {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
            const cb = this.#pending.get(item.id);
            if (!cb) continue;
            this.#pending.delete(item.id);
            if (item.error) {
                const err = Object.assign(new Error(item.error.message ?? 'RPC error'), { code: item.error.code });
                cb.reject(err);
            } else {
                cb.resolve(item.result);
            }
        }
    }

    // ── JSON-RPC 2.0 ────────────────────────────────────────────────────────

    /**
     * Send a JSON-RPC request and return a Promise for the result.
     * @param {string} method
     * @param {object} params
     * @returns {Promise<any>}
     */
    rpc(method, params) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected'));
                return;
            }
            const id = this.#nextId++;
            this.#pending.set(id, { resolve, reject });
            this.#ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        });
    }

    // ── Chat ────────────────────────────────────────────────────────────────

    /**
     * Send a user message in the current conversation.
     *
     * Invokes the "chat" tool via JSON-RPC tools/call.  The arguments
     * match the V1 responses API: model, input, optional previous_response_id,
     * plus endpoint and access_token so the server can route to the correct
     * LLM provider.
     *
     * After a successful response the returned `id` is persisted as the new
     * previous_response_id – enabling stateless-on-client conversation
     * continuation on the next call.
     *
     * @param {string} text  The user's message text.
     * @returns {Promise<object>}  The V1 response object returned by the LLM.
     */
    async sendMessage(text) {
        if (!this.currentConversation) throw new Error('No active conversation');
        if (!this.currentAgent)        throw new Error('No agent selected');

        const { model, endpoint, access_token } = this.currentAgent;
        const { previous_response_id }          = this.currentConversation;

        const args = {
            model,
            input:    text,
            endpoint,
            access_token,
            ...(previous_response_id ? { previous_response_id } : {}),
        };

        const result = await this.rpc('tools/call', { name: 'chat', arguments: args });

        // The tool wraps its output in a content array of {type,text} items
        let response;
        try {
            const raw = result?.content?.[0]?.text;
            response  = raw ? JSON.parse(raw) : result;
        } catch {
            response = result;
        }

        // Persist only the new response ID – not the message history
        const newResponseId = response?.id ?? null;
        if (newResponseId) {
            this.currentConversation = await this.storage.updatePreviousResponseId(
                this.currentConversation.id,
                newResponseId,
            );
        }

        return response;
    }

    // ── Agent & conversation helpers ────────────────────────────────────────

    /**
     * Set the active agent by ID.
     * Clears the current conversation.
     * @param {string} agentId
     */
    async selectAgent(agentId) {
        this.currentAgent        = await this.storage.getAgent(agentId);
        this.currentConversation = null;
        return this.currentAgent;
    }

    /**
     * Create a new conversation for the given agent and make it active.
     * @param {string} agentId
     */
    async startConversation(agentId) {
        this.currentAgent        = await this.storage.getAgent(agentId);
        this.currentConversation = await this.storage.createConversation(agentId);
        return this.currentConversation;
    }

    /**
     * Resume an existing conversation by ID.
     * Also loads the associated agent.
     * @param {string} conversationId
     */
    async selectConversation(conversationId) {
        this.currentConversation = await this.storage.getConversation(conversationId);
        if (this.currentConversation) {
            this.currentAgent = await this.storage.getAgent(this.currentConversation.agent_id);
        }
        return this.currentConversation;
    }
}
