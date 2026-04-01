import Mustache from 'mustache';
import { readdirSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function build_dist(context) {
    const mustacheDir = join(import.meta.dirname, '../mustache');
    const assetsDir = join(import.meta.dirname, '../assets');
    const partialsDir = join(import.meta.dirname, '../partials');
    const dist_dir = join(import.meta.dirname, '../../dist');

    // Load partials (if dir exists)
    const partials = {};
    if (existsSync(partialsDir)) {
        for (const file of readdirSync(partialsDir, { withFileTypes: true })) {
            if (file.isFile() && file.name.endsWith('.mustache')) {
                const name = file.name.replace(/\.mustache$/i, '');
                partials[name] = readFileSync(join(partialsDir, file.name), 'utf8');
                console.log(`Loaded partial: ${name}`);
            }
        }
    }

    // Clean/build dist
    rmSync(dist_dir, { recursive: true, force: true });
    mkdirSync(dist_dir, { recursive: true });

    // Render mustache templates → HTML
    if (existsSync(mustacheDir)) {
        for (const file of readdirSync(mustacheDir, { withFileTypes: true })) {
            if (file.isFile() && file.name.endsWith('.mustache')) {
                const name = file.name;
                const filePath = join(mustacheDir, name);
                const outputName = name.replace(/\.mustache$/i, '.html');
                const outputPath = join(dist_dir, outputName);
                const page_data = readFileSync(filePath, 'utf8');
                // Render w/ context + partials!
                const rendered_html = Mustache.render(page_data, context, partials);
                writeFileSync(outputPath, rendered_html, 'utf8');
                console.log(`Built: ${outputName}`);
            }
        }
    }

    // Copy static assets as-is
    if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir, { withFileTypes: true })) {
            if (file.isFile()) {
                const name = file.name;
                cpSync(join(assetsDir, name), join(dist_dir, name));
                console.log(`Copied: ${name}`);
            }
        }
    }
}