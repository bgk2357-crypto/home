import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, mkdir, cp, rename, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { zipSync } from 'fflate';
import { webstationAdapter } from './webstation-adapter.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'nas-webstation');
const output = path.join(root, 'outputs/synology-webstation');
await import('./prepare-msds-assets.mjs');
await viteBuild({ configFile: false, root: path.join(source, 'frontend'), publicDir: path.join(root, 'public'), plugins: [webstationAdapter(), react()], css: { postcss: { plugins: [] } }, build: { outDir: path.join(output, 'public'), emptyOutDir: true } });
await rename(path.join(output, 'public/index.html'), path.join(output, 'public/shell.html'));
await cp(path.join(source, 'server'), path.join(output, 'server'), { recursive: true });
await cp(path.join(source, 'public'), path.join(output, 'public'), { recursive: true });
await cp(path.join(source, 'config.example.php'), path.join(output, 'config.example.php'));
await cp(path.join(source, 'INSTALL.txt'), path.join(output, 'INSTALL.txt'));
await cp(path.join(root, 'MEMBERSHIP-UPDATE.txt'), path.join(output, 'MEMBERSHIP-UPDATE.txt'));
await mkdir(path.join(output, 'server/migrations'), { recursive: true });
for (const name of (await readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql'))) await cp(path.join(root, 'drizzle', name), path.join(output, 'server/migrations', name));
// Strip annotations in-process, including on the supported Node 22.16 runtime.
const newsModule = stripTypeScriptTypes(await readFile(path.join(root, 'lib/news-sources.ts'), 'utf8'));
const { NEWS_SOURCES } = await import('data:text/javascript;base64,' + Buffer.from(newsModule).toString('base64'));
await writeFile(path.join(output, 'server/news-sources.json'), JSON.stringify(NEWS_SOURCES));
const files = {};
async function collect(directory, prefix = '') { for (const item of await readdir(directory, { withFileTypes: true })) { const relative = prefix + item.name; if (item.isDirectory()) await collect(path.join(directory, item.name), relative + '/'); else if (item.name !== 'config.php') files[relative] = new Uint8Array(await readFile(path.join(directory, item.name))); } }
await collect(output);
await writeFile(path.join(root, 'outputs/synology-webstation.zip'), zipSync(files, { level: 6 }));
console.log('Web Station package: outputs/synology-webstation.zip');
