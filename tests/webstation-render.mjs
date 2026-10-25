import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webstationAdapter } from '../scripts/webstation-adapter.mjs';
const output = path.resolve('.sites-runtime/tests/webstation-render');
await build({ configFile: false, root: process.cwd(), publicDir: false, logLevel: 'error', plugins: [webstationAdapter(), react()], build: { ssr: path.resolve('tests/webstation-render.tsx'), outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'check.mjs' } } } });
await import(pathToFileURL(path.join(output, 'check.mjs')));
