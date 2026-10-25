import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import { build as bundle } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rename, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'nas-webstation');
const output = path.join(root, 'outputs/synology-webstation');
await import('./prepare-msds-assets.mjs');
const replacements = new Map(['auth', 'data', 'runtime-config', 'auth/session'].map(name => [path.join(root, 'app', name).replaceAll('\\', '/'), path.join(source, 'frontend', name === 'auth/session' ? 'session.ts' : name + '.ts')]));
const adapter = {
  name: 'webstation-frontend-adapter', enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'next/navigation') return path.join(source, 'frontend/navigation.ts');
    if (!importer || !id.startsWith('.')) return;
    const resolved = path.resolve(path.dirname(importer.split('?')[0]), id).replaceAll('\\', '/').replace(/\.(tsx?|jsx?)$/, '');
    return replacements.get(resolved);
  },
  async load(id) {
    if (id.replaceAll('\\', '/') !== path.join(root, 'app/components.tsx').replaceAll('\\', '/')) return;
    const code = await readFile(id, 'utf8');
    if (!code.includes('export async function Header()') || !code.includes('const user = await getUser();')) throw Error('Header adapter needs updating');
    return code.replace('export async function Header()', 'export function Header()').replace('const user = await getUser();', 'const user = getUser();');
  },
};
await viteBuild({ configFile: false, root: path.join(source, 'frontend'), publicDir: path.join(root, 'public'), plugins: [adapter, react()], css: { postcss: { plugins: [] } }, build: { outDir: path.join(output, 'public'), emptyOutDir: true } });
await rename(path.join(output, 'public/index.html'), path.join(output, 'public/shell.html'));
await cp(path.join(source, 'server'), path.join(output, 'server'), { recursive: true });
await cp(path.join(source, 'public'), path.join(output, 'public'), { recursive: true });
await cp(path.join(source, 'config.example.php'), path.join(output, 'config.example.php'));
await cp(path.join(source, 'INSTALL.txt'), path.join(output, 'INSTALL.txt'));
await mkdir(path.join(output, 'server/migrations'), { recursive: true });
for (const name of (await readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql'))) await cp(path.join(root, 'drizzle', name), path.join(output, 'server/migrations', name));
const bundled = await bundle({ entryPoints: [path.join(root, 'lib/news-sources.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { NEWS_SOURCES } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
await writeFile(path.join(output, 'server/news-sources.json'), JSON.stringify(NEWS_SOURCES));
const files = {};
async function collect(directory, prefix = '') { for (const item of await readdir(directory, { withFileTypes: true })) { const relative = prefix + item.name; if (item.isDirectory()) await collect(path.join(directory, item.name), relative + '/'); else if (item.name !== 'config.php') files[relative] = new Uint8Array(await readFile(path.join(directory, item.name))); } }
await collect(output);
await writeFile(path.join(root, 'outputs/synology-webstation.zip'), zipSync(files, { level: 6 }));
console.log('Web Station package: outputs/synology-webstation.zip');
