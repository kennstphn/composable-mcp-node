import Mustache from 'mustache';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, '../pages');

let pages = {}; // { 'index': 'Hello {{name}}!', 'about': '...' }

// Load all .mustache files dynamically
for (const file of readdirSync(pagesDir, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith('.mustache')) {
        const name = file.name.slice(0, -8); // 'index.mustache' → 'index'
        const filePath = join(pagesDir, file.name);
        const url = new URL(filePath, import.meta.url).href;

        // Dynamic import as text (Node 22+/24 ✅)
        const module = await import(url, { with: { type: 'text/plain' } });
        pages[name] = module.default; // Raw template string
    }
}

const MISSING_TEMPLATE = `<!-- Template not found -->`;

// Now use as partials: Mustache.render(mainTemplate, view, pages);
export function build_html_page(template_slug, context) {
    // skip escape for HTML generation context,
    return Mustache.render(pages[template_slug] || MISSING_TEMPLATE , context);
}

export function list_pages(){
    return Object.keys(pages);
}