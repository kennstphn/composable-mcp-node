import Mustache from 'mustache';
import { readdirSync, readFileSync, writeFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

export async function build_dist(context) {  // ← async!
    const mustacheDir = join(import.meta.dirname, '../mustache');
    const assetsDir = join(import.meta.dirname, '../assets');
    const partialsDir = join(import.meta.dirname, '../partials');
    const esbuildEntrypointsDir = join(import.meta.dirname, '../esbuild_entry_points');
    const dist_dir = join(import.meta.dirname, '../../dist');

    console.log('🧹 Cleaning dist/');
    rmSync(dist_dir, { recursive: true, force: true });
    mkdirSync(dist_dir, { recursive: true });

    // Load partials
    const partials = {};
    if (existsSync(partialsDir)) {
        for (const file of readdirSync(partialsDir, { withFileTypes: true })) {
            if (file.isFile() && file.name.endsWith('.mustache')) {
                const name = file.name.replace(/\.mustache$/i, '');
                partials[name] = readFileSync(join(partialsDir, file.name), 'utf8');
                console.log(`📄 Loaded partial: ${name}`);
            }
        }
    }

    // 1. Render Mustache → HTML (parallel-ish, but sync FS ok)
    console.log('🏗️  Building HTML...');
    if (existsSync(mustacheDir)) {
        for (const file of readdirSync(mustacheDir, { withFileTypes: true })) {
            if (file.isFile() && file.name.endsWith('.mustache')) {
                const name = file.name;
                const filePath = join(mustacheDir, name);
                const outputName = name.replace(/\.mustache$/i, '.html');
                const outputPath = join(dist_dir, outputName);
                const page_data = readFileSync(filePath, 'utf8');
                const rendered_html = Mustache.render(page_data, context, partials);
                writeFileSync(outputPath, rendered_html, 'utf8');
                console.log(`   📄 ${outputName}`);
            }
        }
    }

    // 2. Copy static assets
    console.log('📦 Copying assets...');
    if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir, { withFileTypes: true })) {
            if (file.isFile()) {
                const name = file.name;
                cpSync(join(assetsDir, name), join(dist_dir, name));
                console.log(`   🖼️  ${name}`);
            }
        }
    }

    // 3. Bundle JS (PARALLEL!)
    console.log('⚡ Bundling JS...');
    if (existsSync(esbuildEntrypointsDir)) {
        const entryFiles = readdirSync(esbuildEntrypointsDir, { withFileTypes: true })
            .filter(file => file.isFile() && (
                file.name.endsWith('.js') ||
                file.name.endsWith('.ts') ||
                file.name.endsWith('.mjs') ||
                file.name.endsWith('.jsx') ||
                file.name.endsWith('.tsx')
            ))
            .map(file => ({
                name: file.name.replace(/\.(ts|jsx?)$/i, '.mjs'),  // Normalize: foo.ts → foo.mjs
                entryPath: join(esbuildEntrypointsDir, file.name)
            }));

        await Promise.all(  // ← Parallel! Fast.
            entryFiles.map(async ({ name, entryPath }) => {
                const outPath = join(dist_dir, name);
                try {
                    await build({
                        entryPoints: [entryPath],
                        outfile: outPath,
                        bundle: true,
                        minify: true,
                        sourcemap: context?.ENV?.NODE_ENV === 'development',  // Fix: context.ENV?
                        platform: 'browser',
                        target: ['es2020'],
                        format: 'esm',
                        loader: {
                            '.css': 'css',           // Prism CSS → <style>
                            '.png|jpg|jpeg|gif|svg|webp|ico': 'file',  // Images → dist/ + URL
                            '.json': 'json',         // Configs → objects
                            '.woff|woff2': 'file'    // Fonts
                        }
                    });
                    console.log(`   ⚡ ${name}`);
                } catch (err) {
                    console.error(`💥 Bundle failed: ${name}`, err);
                    throw err;  // Stop build on error? Or continue.
                }
            })
        );
    }

    console.log('🎉 Build complete! dist/ ready.');
}