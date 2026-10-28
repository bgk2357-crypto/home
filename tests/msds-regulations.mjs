import {build} from 'vite';import path from 'node:path';import {pathToFileURL} from 'node:url';
await build({configFile:false,root:process.cwd(),publicDir:false,logLevel:'error',build:{ssr:path.resolve('tests/msds-regulations.ts'),outDir:path.resolve('.sites-runtime/tests/msds-regulations'),emptyOutDir:true,rollupOptions:{output:{entryFileNames:'check.mjs'}}}});
await import(pathToFileURL(path.resolve('.sites-runtime/tests/msds-regulations/check.mjs')).href);
