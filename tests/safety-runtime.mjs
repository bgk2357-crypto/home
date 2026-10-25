import { build } from 'vite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
await build({configFile:false,root:process.cwd(),publicDir:false,logLevel:'error',resolve:{alias:{'next/headers':'\0safety-headers'}},plugins:[{
 name:'safety-test-runtime',resolveId(id){if(id==='cloudflare:workers')return '\0safety-env';if(id==='next/headers')return '\0safety-headers';},
 load(id){if(id==='\0safety-env')return 'export const env=new Proxy({}, {get(_t,k){return globalThis.safetyEnv?.[k]}});';if(id==='\0safety-headers')return 'export async function headers(){return globalThis.safetyHeaders;}';}
}],build:{ssr:path.resolve('tests/safety-runtime.ts'),outDir:path.resolve('.sites-runtime/tests/safety-runtime'),emptyOutDir:true,rollupOptions:{output:{entryFileNames:'check.mjs'}}}});
await import(pathToFileURL(path.resolve('.sites-runtime/tests/safety-runtime/check.mjs')).href);
