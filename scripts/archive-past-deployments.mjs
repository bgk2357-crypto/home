import { readdir, stat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const output = fileURLToPath(new URL('../outputs/', import.meta.url));
// Only reprocess artifacts already recorded by this HOME migration.
// A new unrelated file placed in outputs must never be swept into the archive.
const approvedNames = new Set();
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
  try {
    const manifest = JSON.parse(await readFile(path.join(output, entry.name, '과거배포본_정리목록.json'), 'utf8'));
    for (const file of manifest.files) approvedNames.add(file.file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const hash = data => createHash('sha256').update(data).digest('hex');
const groups = new Map();
async function preserve(destination, bytes) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(destination, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (hash(await readFile(destination)) !== hash(bytes)) throw new Error(`Existing file differs: ${destination}`);
  }
  if (hash(await readFile(destination)) !== hash(bytes)) throw new Error(`Copy verification failed: ${destination}`);
}
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (!entry.isFile() || !approvedNames.has(entry.name)) continue;
  const source = path.join(output, entry.name);
  const info = await stat(source);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(info.mtime);
  const daily = path.join(output, day);
  const bytes = await readFile(source);
  await preserve(path.join(daily, entry.name), bytes);
  let extracted = '';
  if (/\.zip$/i.test(entry.name)) {
    const directory = path.join(daily, entry.name.slice(0, -4));
    for (const [relative, content] of Object.entries(unzipSync(bytes))) {
      const destination = path.resolve(directory, relative);
      if (!destination.startsWith(directory + path.sep)) throw new Error(`Unsafe archive path: ${relative}`);
      if (relative.endsWith('/')) { await mkdir(destination, { recursive: true }); continue; }
      await preserve(destination, content);
    }
    extracted = path.basename(directory);
  }
  const rows = groups.get(day) || [];
  rows.push({ file: entry.name, originalModifiedAt: info.mtime.toISOString(), sha256: hash(bytes), extracted });
  groups.set(day, rows);
}
for (const [day, files] of groups) {
  const daily = path.join(output, day);
  await writeFile(path.join(daily, '과거배포본_정리목록.json'), JSON.stringify({ dateBasis: '원본 파일의 수정 시각을 Asia/Seoul 날짜로 변환. 실제 작업일을 보장하지 않음.', files }, null, 2));
  await writeFile(path.join(daily, '과거배포본_보관안내.txt'), [
    `${day} 과거 작업 배포본 보관`,
    '기존 outputs 최상위 파일을 수정 날짜(한국 시간) 기준으로 복사했습니다. 원본은 보존했습니다.',
    '이 날짜는 파일 수정일이며, 실제 작업일이나 기능 완성일을 보장하지 않습니다.',
    'ZIP은 같은 이름의 폴더에 압축 해제했습니다. TAR.GZ는 압축 파일 그대로 보관했습니다.',
    '기존 적용 안내와 검토 화면도 함께 복사했습니다. SHA256과 원본 수정 시각은 정리목록 JSON에 있습니다.',
    '오래된 배포본은 당시 기능만 포함합니다. 현재 최신 기능이 필요하면 최신 날짜의 배포본을 사용하세요.',
    '', ...files.map(file => file.file),
  ].join('\r\n'));
  console.log(`${day}: ${files.length} files, ${files.filter(file => file.extracted).length} ZIPs extracted; copies verified`);
}
