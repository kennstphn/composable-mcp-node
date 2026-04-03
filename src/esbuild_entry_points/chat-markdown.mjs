import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Prism from 'prismjs';  // npm i prismjs prismjs/components/prism-*
import 'prismjs/themes/prism-tomorrow.css';  // Or prism-okaidia.css (dark theme fave)
import 'prismjs/components/prism-javascript';  // No .js ext!
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';  // LLM staples

// Global highlight fn (runs in browser DOM)
marked.setOptions({
    highlight: (code, lang = 'plaintext') => {  // 'plaintext' > 'text'
        const grammar = Prism.languages[lang] || Prism.languages.text || Prism.languages.plaintext;
        const highlighted = Prism.highlight(code, grammar, lang);
        return highlighted;  // Prism wraps in <pre><code class="language-xxx">
    },
    breaks: true,  // \n → <br> (chat-friendly)
    gfm: true      // Tables/lists
});

// Main: MD → safe HTML string
export function markdownToHtml(markdown, options = {}) {
    if (!markdown?.trim()) throw new Error('Invalid markdown input');

    const html = marked.parse(markdown, {
        highlight: marked.defaults.highlight,  // Use global
        ...options,  // User overrides (e.g., { headerIds: true })
        // highlight already global
    });
    return DOMPurify.sanitize(html, { ADD_TAGS: ['style'] });  // Allow Prism CSS
}

// Render to DOM (auto-highlights)
export function renderMarkdown(markdown, container, options = {}) {
    if (!container) throw new Error('No container');
    const html = markdownToHtml(markdown, options);
    container.innerHTML = html;
    // Re-highlight any new code (Prism needs DOM)
    Prism.highlightAllUnder(container);
}
