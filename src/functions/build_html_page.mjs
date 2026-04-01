import Mustache from 'mustache';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, '../pages');

let pages = {}; // { 'index': 'Hello {{name}}!', ... }

// Load all .mustache files dynamically
for (const file of readdirSync(pagesDir, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith('.mustache')) {
        const name = file.name.slice(0, -8); // 'index.mustache' → 'index'
        const filePath = join(pagesDir, file.name);

        // Read as UTF-8 text (synchronous for startup simplicity)
        pages[name] = readFileSync(filePath, 'utf8');
    }
}


export function build_html_page(template_slug, context) {
    const template = pages[template_slug] || `<!-- Template "${template_slug}" not found -->`;
    // Mustache.render already handles HTML escaping by default.
    // Use { escape: (text) => text } only if you want raw HTML output.
    return Mustache.render(template, context);
}

export function list_pages() {
    return Object.keys(pages);
}