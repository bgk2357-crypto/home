import {build} from 'vite';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await build({configFile:false,publicDir:false,logLevel:'error',build:{ssr:path.resolve('tests/management-selection.ts'),outDir:'.sites-runtime/tests/management-selection',emptyOutDir:true,rollupOptions:{output:{entryFileNames:'check.mjs'}}}});
await import(pathToFileURL(path.resolve('.sites-runtime/tests/management-selection/check.mjs')).href);
