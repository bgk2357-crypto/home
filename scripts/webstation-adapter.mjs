import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function webstationAdapter() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = path.join(root, 'nas-webstation');
  const replacements = new Map(['auth', 'data', 'runtime-config', 'auth/session'].map(name => [path.join(root, 'app', name).replaceAll('\\', '/'), path.join(source, 'frontend', name === 'auth/session' ? 'session.ts' : name + '.ts')]));
  return {
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
}
