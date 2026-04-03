import {ChatApp} from './modules/ChatApp.mjs';
import {renderMarkdown} from "./chat-markdown.mjs";
import './modules/chat.css';

// ── Globals ─────────────────────────────────────────────────────────────────
const env = window.$env || {
    DIRECTUS_BASE_URL: '',
    ROUTES_PREFIX: '',
};
const app = new ChatApp(env);

// In-memory message log for the current conversation view
let messages = [];
// Track the agent being edited (for the agent form)
let editingAgentId = null;
// Conversation history pagination state
let historyOldestTimestamp = null;
let historyHasMore = false;
let historyLoading = false;


// ── Boot — check session via Directus /users/me ───────────────────────────────
(async function init() {
    try {
        const res = await fetch(`${env.DIRECTUS_BASE_URL}/users/me`, {credentials: 'include'});
        if (res.ok) {
            // Authenticated — hide auth screen, show app, connect WS
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');
            app.connect();
        } else {
            showLoginScreen();
        }
    } catch {
        showLoginScreen();
    }
})();

// ── Auth helpers ──────────────────────────────────────────────────────────────
function showLoginScreen() {
    document.getElementById('auth-checking').classList.add('hidden');
    document.getElementById('auth-login').classList.remove('hidden');
}

app.addEventListener('connected', async () => {
    document.getElementById('disconnected-banner').classList.add('hidden');
    setConnDot('online');
    await refreshAgentList();
    await autoSelectMostRecent();
});

app.addEventListener('disconnected', () => {
    setConnDot('offline');
    if (!document.getElementById('app').classList.contains('hidden')) {
        document.getElementById('disconnected-banner').classList.remove('hidden');
    }
});

app.addEventListener('ws-error', () => {
    setConnDot('offline');
    if (!document.getElementById('app').classList.contains('hidden')) {
        document.getElementById('disconnected-banner').classList.remove('hidden');
    }
});

app.addEventListener('conversation-renamed', async () => {
    await refreshConversationList();
});

window.reconnect = async function reconnect() {
    document.getElementById('disconnected-banner').classList.add('hidden');
    try {
        const res = await fetch(`${env.DIRECTUS_BASE_URL}/users/me`, {credentials: 'include'});
        if (res.ok) {
            app.connect();
        } else {
            document.getElementById('app').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('hidden');
            showLoginScreen();
        }
    } catch {
        document.getElementById('app').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
        showLoginScreen();
    }
};

// ── Connection dot ────────────────────────────────────────────────────────────
function setConnDot(state) {
    const dot = document.getElementById('conn-dot');
    dot.className = 'conn-dot ' + state;
    dot.title = state === 'online' ? 'Connected' : state === 'offline' ? 'Disconnected' : 'Connecting…';
}

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────
window.toggleSidebar = function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-backdrop').classList.toggle('open');
};

window.closeSidebar = function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('open');
};

// ── Agent form ────────────────────────────────────────────────────────────────
window.toggleAgentForm = function toggleAgentForm(agentId, event) {
    if (event) event.stopPropagation();
    const form = document.getElementById('agent-form');
    const isHidden = form.classList.contains('hidden');
    if (!isHidden && editingAgentId === agentId) {
        cancelAgentForm();
        return;
    }
    editingAgentId = agentId ?? null;
    if (agentId) {
        // Pre-fill for editing
        app.storage.getAgent(agentId).then(agent => {
            if (!agent) return;
            document.getElementById('af-name').value = agent.name;
            document.getElementById('af-model').value = agent.model;
            document.getElementById('af-endpoint').value = agent.endpoint;
            document.getElementById('af-token').value = agent.access_token;
            document.getElementById('af-input-rate').value = agent.input_rate ?? '';
            document.getElementById('af-output-rate').value = agent.output_rate ?? '';
            document.getElementById('af-cached-rate').value = agent.cached_rate ?? '';
            form.classList.remove('hidden');
        });
    } else {
        clearAgentForm();
        form.classList.remove('hidden');
    }
};

window.cancelAgentForm = function cancelAgentForm() {
    document.getElementById('agent-form').classList.add('hidden');
    clearAgentForm();
    editingAgentId = null;
};

function clearAgentForm() {
    ['af-name', 'af-model', 'af-endpoint', 'af-token', 'af-input-rate', 'af-output-rate', 'af-cached-rate'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('af-error').textContent = '';
}

window.saveAgent = async function saveAgent() {
    const name = document.getElementById('af-name').value.trim();
    const model = document.getElementById('af-model').value.trim();
    const endpoint = document.getElementById('af-endpoint').value.trim();
    const access_token = document.getElementById('af-token').value.trim();
    const inputRateStr = document.getElementById('af-input-rate').value.trim();
    const outputRateStr = document.getElementById('af-output-rate').value.trim();
    const cachedRateStr = document.getElementById('af-cached-rate').value.trim();
    const input_rate = inputRateStr !== '' ? parseFloat(inputRateStr) : null;
    const output_rate = outputRateStr !== '' ? parseFloat(outputRateStr) : null;
    const cached_rate = cachedRateStr !== '' ? parseFloat(cachedRateStr) : null;

    const errEl = document.getElementById('af-error');
    if (!name || !model || !endpoint) {
        errEl.textContent = 'Name, model, and endpoint are required.';
        return;
    }
    errEl.textContent = '';

    await app.storage.saveAgent({
        id: editingAgentId ?? undefined,
        name,
        model,
        endpoint,
        access_token,
        input_rate,
        output_rate,
        cached_rate
    });
    cancelAgentForm();
    await refreshAgentList();
};

window.deleteAgent = async function deleteAgent(id, event) {
    event.stopPropagation();
    if (!confirm('Delete this agent and all its conversations?')) return;
    if (app.currentAgent?.id === id) {
        clearChatView();
        app.currentAgent = null;
        app.currentConversation = null;
    }
    await app.storage.deleteAgent(id);
    await refreshAgentList();
};

// ── Agent list ────────────────────────────────────────────────────────────────
async function refreshAgentList() {
    const agents = await app.storage.getAgents();
    const list = document.getElementById('agent-list');

    if (!agents.length) {
        list.innerHTML = '<div class="empty-hint">No agents yet.</div>';
        return;
    }

    list.innerHTML = agents.map(a => `
        <div class="list-item ${app.currentAgent?.id === a.id ? 'active' : ''}"
             onclick="selectAgent('${esc(a.id)}')">
            <span class="item-icon">🤖</span>
            <span class="item-label">${esc(a.name)}</span>
            <span class="item-actions">
                <button class="btn-ghost btn-sm" onclick="toggleAgentForm('${esc(a.id)}', event)" title="Edit">✎</button>
                <button class="btn-danger btn-sm" onclick="deleteAgent('${esc(a.id)}', event)" title="Delete">✕</button>
            </span>
        </div>
    `).join('');
}

// ── Select agent ──────────────────────────────────────────────────────────────
window.selectAgent = async function selectAgent(agentId) {
    await app.selectAgent(agentId);
    await refreshAgentList();
    await refreshConversationList();
    document.getElementById('new-conv-btn').disabled = false;
    clearChatView();
    closeSidebar();
};

// ── Conversation list ─────────────────────────────────────────────────────────
async function refreshConversationList() {
    const list = document.getElementById('conversation-list');

    if (!app.currentAgent) {
        list.innerHTML = '<div class="empty-hint">Select an agent.</div>';
        return;
    }

    // getConversationsForAgent already returns most-recent-first
    const convs = await app.storage.getConversationsForAgent(app.currentAgent.id);

    if (!convs.length) {
        list.innerHTML = '<div class="empty-hint">No conversations yet.</div>';
        return;
    }

    list.innerHTML = convs.map(c => {
        const label = c.title ?? formatConvDate(c.created_at);
        return `
        <div class="list-item ${app.currentConversation?.id === c.id ? 'active' : ''}"
             onclick="openConversation('${esc(c.id)}')">
            <span class="item-icon">💬</span>
            <span class="item-label">${esc(label)}</span>
            <span class="item-actions">
                <button class="btn-ghost btn-sm" onclick="renameConversation('${esc(c.id)}', event)" title="Rename">✎</button>
                <button class="btn-danger btn-sm" onclick="deleteConversation('${esc(c.id)}', event)" title="Delete">✕</button>
            </span>
        </div>
    `;
    }).join('');
}

function formatConvDate(isoStr) {
    if (!isoStr) return 'New conversation';
    const d = new Date(isoStr);
    if (isNaN(d)) return 'New conversation';
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}

window.newConversation = async function newConversation() {
    if (!app.currentAgent) return;
    await app.startConversation(app.currentAgent.id);
    messages = [];
    historyOldestTimestamp = null;
    historyHasMore = false;
    historyLoading = false;
    openChatView();
    await refreshConversationList();
};

window.openConversation = async function openConversation(id) {
    await app.selectConversation(id);
    messages = [];
    historyOldestTimestamp = null;
    historyHasMore = false;
    historyLoading = false;
    await loadInitialHistory();
    openChatView();
    await refreshConversationList();
    await refreshAgentList();
    closeSidebar();
};

window.deleteConversation = async function deleteConversation(id, event) {
    event.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    if (app.currentConversation?.id === id) {
        clearChatView();
        app.currentConversation = null;
    }
    await app.storage.deleteConversation(id);
    await refreshConversationList();
};

window.renameConversation = async function renameConversation(id, event) {
    event.stopPropagation();
    const conv = await app.storage.getConversation(id);
    if (!conv) return;
    const current = conv.title ?? '';
    const newTitle = prompt('Rename conversation:', current);
    if (newTitle === null) return; // cancelled
    const trimmed = newTitle.trim();
    await app.storage.updateConversationTitle(id, trimmed || null);
    if (app.currentConversation?.id === id) {
        app.currentConversation = await app.storage.getConversation(id);
    }
    await refreshConversationList();
};

// ── Chat view ─────────────────────────────────────────────────────────────────
function openChatView() {
    document.getElementById('chat-placeholder').classList.add('hidden');
    const view = document.getElementById('chat-view');
    view.classList.remove('hidden');

    const agent = app.currentAgent;
    document.getElementById('agent-avatar').textContent = (agent?.name?.[0] ?? '?').toUpperCase();
    document.getElementById('header-agent-name').textContent = agent?.name ?? '—';
    document.getElementById('header-agent-model').textContent = agent?.model ?? '';

    renderMessages();
    updateCostDisplay();
    document.getElementById('message-input').focus();
}

function clearChatView() {
    document.getElementById('chat-placeholder').classList.remove('hidden');
    const view = document.getElementById('chat-view');
    view.classList.add('hidden');
    messages = [];
    historyOldestTimestamp = null;
    historyHasMore = false;
    historyLoading = false;
    document.getElementById('header-cost').textContent = '';
}

function renderMessages() {
    const container = document.getElementById('messages');
    container.innerHTML = messages.map(m => buildMsgHTML(m)).join('');
    container.scrollTop = container.scrollHeight;
}

function addMessage(role, text, extra) {
    const msg = {role, text, ...extra};
    messages.push(msg);
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.innerHTML = buildMsgHTML(msg);
    container.appendChild(div.firstElementChild);
    container.scrollTop = container.scrollHeight;
    return msg;
}

function buildMsgHTML(msg) {
    const cls = msg.role === 'user' ? 'user' : msg.role === 'error' ? 'error' : 'bot';
    const label = msg.role === 'user' ? 'You' : msg.role === 'error' ? 'Error' : (app.currentAgent?.name ?? 'Assistant');
    let content;
    if (msg.thinking) {
        content = '<span class="dots"></span>';
    } else if (msg.role === 'bot') {
        let container = document.createElement('div');
        renderMarkdown(msg.text, container);
        content = container.innerHTML;
    } else {
        content = esc(msg.text);
    }
    return `
        <div class="msg ${cls} ${msg.thinking ? 'msg-thinking' : ''}">
            <div class="msg-role">${esc(label)}</div>
            <div class="msg-bubble">${content}</div>
        </div>
    `;
}

// ── Send message ──────────────────────────────────────────────────────────────
window.sendMessage = async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    if (!app.connected) {
        addMessage('error', 'Not connected. Please reconnect.');
        return;
    }
    if (!app.currentConversation) {
        addMessage('error', 'Start a conversation first.');
        return;
    }

    input.value = '';
    autoGrow(input);

    addMessage('user', text);

    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    input.disabled = true;

    // Show a thinking indicator
    const thinkingMsg = addMessage('bot', '', {thinking: true});

    try {
        const response = await app.sendMessage(text);

        // Remove thinking indicator
        removeLastThinking();

        // Extract text output from V1 response format
        const replyText = extractResponseText(response);
        addMessage('bot', replyText);
        await updateCostDisplay();

    } catch (err) {
        removeLastThinking();
        addMessage('error', err.message ?? 'An error occurred.');
    } finally {
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
};

function removeLastThinking() {
    const container = document.getElementById('messages');
    const items = container.querySelectorAll('.msg-thinking');
    items[items.length - 1]?.remove();
    messages = messages.filter(m => !m.thinking);
}

/** Extract display text from a V1 responses API response object. */
function extractResponseText(response) {
    if (!response) return '(empty response)';
    // V1 responses API: output is an array of content blocks
    if (Array.isArray(response.output)) {
        const parts = [];
        for (const block of response.output) {
            if (block.type === 'message' && Array.isArray(block.content)) {
                for (const c of block.content) {
                    if (c.type === 'output_text' && c.text) parts.push(c.text);
                    else if (c.type === 'text' && c.text) parts.push(c.text);
                }
            } else if (block.type === 'text' && block.text) {
                parts.push(block.text);
            }
        }
        if (parts.length) return parts.join('\n');
    }
    // Fallback: plain text field
    if (typeof response.output_text === 'string') return response.output_text;
    if (typeof response.text === 'string') return response.text;
    // Last resort
    return JSON.stringify(response, null, 2);
}

// ── Input helpers ─────────────────────────────────────────────────────────────
window.handleInputKey = function handleInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

window.autoGrow = function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
};

// ── History pagination ────────────────────────────────────────────────────────

async function loadInitialHistory() {
    if (!app.currentConversation) return;
    const batch = await app.storage.getHistoryBatch(app.currentConversation.id, {limit: 20});
    historyHasMore = batch.length === 20;
    historyOldestTimestamp = batch.length > 0 ? batch[0].created_at : null;

    messages = batch.map(h => ({
        role: h.role === 'assistant' ? 'bot' : h.role,
        text: h.content_snippet ?? '',
    }));
    renderMessages();

    const container = document.getElementById('messages');
    container.scrollTop = container.scrollHeight;
}

async function loadMoreHistory() {
    if (!historyHasMore || historyLoading || !historyOldestTimestamp || !app.currentConversation) return;
    historyLoading = true;
    const container = document.getElementById('messages');
    container.classList.add('loading-history');
    const prevScrollHeight = container.scrollHeight;

    try {
        const batch = await app.storage.getHistoryBatch(app.currentConversation.id, {
            before: historyOldestTimestamp,
            limit: 20,
        });

        if (batch.length === 0) {
            historyHasMore = false;
            return;
        }

        historyHasMore = batch.length === 20;
        historyOldestTimestamp = batch[0].created_at;

        const prepend = batch.map(h => ({
            role: h.role === 'assistant' ? 'bot' : h.role,
            text: h.content_snippet ?? '',
        }));
        messages = [...prepend, ...messages];
        renderMessages();

        // Restore scroll position so the user stays at the same spot
        container.scrollTop = container.scrollHeight - prevScrollHeight;
    } finally {
        historyLoading = false;
        container.classList.remove('loading-history');
    }
}

// Attach scroll listener once; fires only when scrolled near the top
document.getElementById('messages').addEventListener('scroll', function () {
    if (this.scrollTop < 80 && historyHasMore && !historyLoading) {
        loadMoreHistory();
    }
});

// ── Cost display ──────────────────────────────────────────────────────────────
async function updateCostDisplay() {
    const el = document.getElementById('header-cost');
    if (!el) return;

    const conv = app.currentConversation;
    const agent = app.currentAgent;
    if (!conv || !agent) {
        el.textContent = '';
        return;
    }

    const usage = await app.storage.getConversationTotalUsage(conv.id);
    if (!usage.total_tokens && !usage.cost_in_usd_ticks) {
        el.textContent = '';
        return;
    }

    let costStr = '';
    const hasRates = ((agent.input_rate ?? 0) > 0) || ((agent.output_rate ?? 0) > 0) || ((agent.cached_rate ?? 0) > 0);
    if (hasRates) {
        const cachedTokens = usage.cached_tokens ?? 0;
        const nonCached = Math.max(0, usage.input_tokens - cachedTokens);
        // cached_rate falls back to input_rate when not separately configured
        const cachedRate = agent.cached_rate ?? agent.input_rate ?? 0;
        const cost = (
            nonCached * (agent.input_rate ?? 0) +
            cachedTokens * cachedRate +
            usage.output_tokens * (agent.output_rate ?? 0)
        ) / 1_000_000;
        costStr = `$${cost.toFixed(4)}`;
    }

    const parts = [];
    if (costStr) parts.push(costStr);
    if (usage.total_tokens) {
        const detail = usage.cached_tokens
            ? `${usage.total_tokens.toLocaleString()} tokens (${usage.cached_tokens.toLocaleString()} cached)`
            : `${usage.total_tokens.toLocaleString()} tokens`;
        parts.push(detail);
    }
    el.textContent = parts.join(' · ');
}

// ── Auto-select most recent conversation on connect ───────────────────────────
async function autoSelectMostRecent() {
    const convs = await app.storage.getConversations();
    if (!convs.length) return;

    const sorted = [...convs].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at) : new Date(0);
        const db = b.created_at ? new Date(b.created_at) : new Date(0);
        return db - da;
    });

    const mostRecent = sorted[0];
    if (!mostRecent) return;

    // Make sure the agent exists before proceeding
    const agent = await app.storage.getAgent(mostRecent.agent_id);
    if (!agent) return;

    await app.selectAgent(mostRecent.agent_id);
    await refreshAgentList();
    await refreshConversationList();
    document.getElementById('new-conv-btn').disabled = false;

    await app.selectConversation(mostRecent.id);
    await loadInitialHistory();
    openChatView();
    await refreshConversationList();
    await updateCostDisplay();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}