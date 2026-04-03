/**
 * Async localStorage wrapper for chat agents, conversations, and conversation history.
 *
 * Schema
 * ──────
 * agents:        [{ id, name, model, endpoint, access_token, per_million_tokens, created_at }]
 * conversations: [{ id, agent_id, title, previous_response_id, created_at }]
 * history:       [{ id, conversation_id, response_id, role, content_snippet, usage, created_at }]
 *
 * All methods are async so the backing store can be swapped out later
 * (e.g. IndexedDB, a remote API) without changing call-sites.
 */

const AGENTS_KEY        = 'chat_agents';
const CONVERSATIONS_KEY = 'chat_conversations';
const HISTORY_KEY       = 'chat_conversation_history';

export class ChatStorage {

    constructor(env) {
        this.env = env;
    }

    // ── Agents ─────────────────────────────────────────────────────────────

    async getAgents() {
        const raw = localStorage.getItem(AGENTS_KEY);
        return raw ? JSON.parse(raw) : [];
    }

    async getAgent(id) {
        const agents = await this.getAgents();
        return agents.find(a => a.id === id) ?? null;
    }

    /**
     * Create or update an agent.
     * If `agent.id` is omitted a new UUID is assigned.
     * @param {{ id?: string, name: string, model: string, endpoint: string, access_token: string, per_million_tokens?: number|null }} agent
     * @returns {Promise<object>}
     */
    async saveAgent(agent) {
        const agents = await this.getAgents();
        const id     = agent.id ?? crypto.randomUUID();
        const existing = agents.find(a => a.id === id);
        const record = {
            id,
            name:               agent.name,
            model:              agent.model,
            endpoint:           agent.endpoint,
            access_token:       agent.access_token,
            per_million_tokens: agent.per_million_tokens ?? null,
            created_at:         existing?.created_at ?? new Date().toISOString(),
        };
        const idx = agents.findIndex(a => a.id === id);
        if (idx >= 0) agents[idx] = record;
        else          agents.push(record);
        localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
        return record;
    }

    /**
     * Delete an agent and all conversations and history that belong to it.
     * @param {string} id
     */
    async deleteAgent(id) {
        const agents = await this.getAgents();
        localStorage.setItem(AGENTS_KEY, JSON.stringify(agents.filter(a => a.id !== id)));

        // Cascade-delete conversations owned by this agent
        const convs = await this.getConversations();
        const agentConvIds = new Set(convs.filter(c => c.agent_id === id).map(c => c.id));
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs.filter(c => c.agent_id !== id)));

        // Cascade-delete conversation history
        if (agentConvIds.size > 0) {
            const history = await this._getHistory();
            localStorage.setItem(HISTORY_KEY, JSON.stringify(
                history.filter(h => !agentConvIds.has(h.conversation_id)),
            ));
        }
    }

    // ── Conversations ──────────────────────────────────────────────────────

    async getConversations() {
        const raw = localStorage.getItem(CONVERSATIONS_KEY);
        return raw ? JSON.parse(raw) : [];
    }

    async getConversation(id) {
        const convs = await this.getConversations();
        return convs.find(c => c.id === id) ?? null;
    }

    async getConversationsForAgent(agent_id) {
        const convs = await this.getConversations();
        return convs
            .filter(c => c.agent_id === agent_id)
            .sort((a, b) => {
                const da = a.created_at ? new Date(a.created_at) : new Date(0);
                const db = b.created_at ? new Date(b.created_at) : new Date(0);
                return db - da; // most recent first
            });
    }

    /**
     * Create a new conversation for the given agent.
     * `previous_response_id` and `title` start as null.
     * @param {string} agent_id
     * @returns {Promise<{ id: string, agent_id: string, title: null, previous_response_id: null, created_at: string }>}
     */
    async createConversation(agent_id) {
        const conv  = {
            id:                   crypto.randomUUID(),
            agent_id,
            title:                null,
            previous_response_id: null,
            created_at:           new Date().toISOString(),
        };
        const convs = await this.getConversations();
        convs.push(conv);
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
        return conv;
    }

    /**
     * Persist only the latest response ID for a conversation.
     * @param {string} conversation_id
     * @param {string} previous_response_id
     * @returns {Promise<object|null>}
     */
    async updatePreviousResponseId(conversation_id, previous_response_id) {
        const convs = await this.getConversations();
        const idx   = convs.findIndex(c => c.id === conversation_id);
        if (idx < 0) return null;
        convs[idx] = { ...convs[idx], previous_response_id };
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
        return convs[idx];
    }

    /**
     * Update the title of a conversation.
     * @param {string} conversation_id
     * @param {string} title
     * @returns {Promise<object|null>}
     */
    async updateConversationTitle(conversation_id, title) {
        const convs = await this.getConversations();
        const idx   = convs.findIndex(c => c.id === conversation_id);
        if (idx < 0) return null;
        convs[idx] = { ...convs[idx], title };
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
        return convs[idx];
    }

    async deleteConversation(id) {
        const convs = await this.getConversations();
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs.filter(c => c.id !== id)));
        await this.deleteHistoryForConversation(id);
    }

    // ── Conversation History ────────────────────────────────────────────────

    /** @returns {Promise<Array>} */
    async _getHistory() {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    }

    /**
     * Save a history entry for a conversation turn.
     * @param {{ conversation_id: string, response_id: string|null, role: string, content_snippet: string|null, usage: object|null, created_at?: string }} entry
     * @returns {Promise<object>}
     */
    async saveHistoryEntry(entry) {
        const history = await this._getHistory();
        const record  = {
            id:              crypto.randomUUID(),
            conversation_id: entry.conversation_id,
            response_id:     entry.response_id     ?? null,
            role:            entry.role,
            content_snippet: entry.content_snippet ?? null,
            usage:           entry.usage           ?? null,
            created_at:      entry.created_at      ?? new Date().toISOString(),
        };
        history.push(record);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        return record;
    }

    /**
     * Get a paginated batch of history entries for a conversation.
     * Entries are returned in chronological order (oldest first).
     * Pass `before` (ISO timestamp) to page backwards through older messages.
     *
     * @param {string} conversation_id
     * @param {{ before?: string|null, limit?: number }} options
     * @returns {Promise<Array>}
     */
    async getHistoryBatch(conversation_id, { before = null, limit = 20 } = {}) {
        const history = await this._getHistory();
        let entries = history
            .filter(h => h.conversation_id === conversation_id)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // ASC

        if (before) {
            entries = entries.filter(h => new Date(h.created_at) < new Date(before));
        }

        // Return the last `limit` entries (the most recent ones within range)
        return entries.slice(-limit);
    }

    /**
     * Delete all history entries for a conversation.
     * @param {string} conversation_id
     */
    async deleteHistoryForConversation(conversation_id) {
        const history = await this._getHistory();
        localStorage.setItem(HISTORY_KEY, JSON.stringify(
            history.filter(h => h.conversation_id !== conversation_id),
        ));
    }

    /**
     * Sum token usage across all history entries for a conversation.
     * @param {string} conversation_id
     * @returns {Promise<{ input_tokens: number, output_tokens: number, total_tokens: number }>}
     */
    async getConversationTotalUsage(conversation_id) {
        const history = await this._getHistory();
        return history
            .filter(h => h.conversation_id === conversation_id && h.usage)
            .reduce((acc, h) => {
                acc.input_tokens  += h.usage.input_tokens  ?? 0;
                acc.output_tokens += h.usage.output_tokens ?? 0;
                acc.total_tokens  += h.usage.total_tokens  ??
                    ((h.usage.input_tokens ?? 0) + (h.usage.output_tokens ?? 0));
                return acc;
            }, { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    }
}
