/**
 * Async localStorage wrapper for chat agents and conversations.
 *
 * Schema
 * ──────
 * agents:        [{ id, name, model, endpoint, access_token }]
 * conversations: [{ id, agent_id, previous_response_id }]
 *
 * All methods are async so the backing store can be swapped out later
 * (e.g. IndexedDB, a remote API) without changing call-sites.
 */

const AGENTS_KEY        = 'chat_agents';
const CONVERSATIONS_KEY = 'chat_conversations';

export class ChatStorage {

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
     * @param {{ id?: string, name: string, model: string, endpoint: string, access_token: string }} agent
     * @returns {Promise<{ id: string, name: string, model: string, endpoint: string, access_token: string }>}
     */
    async saveAgent(agent) {
        const agents = await this.getAgents();
        const id     = agent.id ?? crypto.randomUUID();
        const record = { id, name: agent.name, model: agent.model, endpoint: agent.endpoint, access_token: agent.access_token };
        const idx    = agents.findIndex(a => a.id === id);
        if (idx >= 0) agents[idx] = record;
        else          agents.push(record);
        localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
        return record;
    }

    /**
     * Delete an agent and all conversations that belong to it.
     * @param {string} id
     */
    async deleteAgent(id) {
        const agents = await this.getAgents();
        localStorage.setItem(AGENTS_KEY, JSON.stringify(agents.filter(a => a.id !== id)));

        // Cascade-delete conversations owned by this agent
        const convs = await this.getConversations();
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs.filter(c => c.agent_id !== id)));
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
        return convs.filter(c => c.agent_id === agent_id);
    }

    /**
     * Create a new conversation for the given agent.
     * `previous_response_id` starts as null.
     * @param {string} agent_id
     * @returns {Promise<{ id: string, agent_id: string, previous_response_id: null }>}
     */
    async createConversation(agent_id) {
        const conv  = { id: crypto.randomUUID(), agent_id, previous_response_id: null };
        const convs = await this.getConversations();
        convs.push(conv);
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
        return conv;
    }

    /**
     * Persist only the latest response ID for a conversation.
     * The full message history is intentionally not stored.
     * @param {string} conversation_id
     * @param {string} previous_response_id
     * @returns {Promise<{ id: string, agent_id: string, previous_response_id: string }|null>}
     */
    async updatePreviousResponseId(conversation_id, previous_response_id) {
        const convs = await this.getConversations();
        const idx   = convs.findIndex(c => c.id === conversation_id);
        if (idx < 0) return null;
        convs[idx] = { ...convs[idx], previous_response_id };
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
        return convs[idx];
    }

    async deleteConversation(id) {
        const convs = await this.getConversations();
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs.filter(c => c.id !== id)));
    }
}
