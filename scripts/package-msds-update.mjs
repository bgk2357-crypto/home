import { readFile, writeFile, readdir } from 'node:fs/promises';
import { zipSync } from 'fflate';
const root = new URL('../outputs/synology-webstation/public/', import.meta.url);
const files = {};
async function collect(url, prefix) { for (const item of await readdir(url, { withFileTypes: true })) { const child = new URL(item.name + (item.isDirectory() ? '/' : ''), url); if (item.isDirectory()) await collect(child, prefix + item.name + '/'); else files[prefix + item.name] = new Uint8Array(await readFile(child)); } }
await collect(new URL('assets/', root), 'public/assets/');
await collect(new URL('ghs/', root), 'public/ghs/');
files['public/.htaccess'] = new Uint8Array(await readFile(new URL('.htaccess', root)));
files['public/vendor/pdf.worker.min.mjs'] = new Uint8Array(await readFile(new URL('vendor/pdf.worker.min.mjs', root)));
files['public/templates/blank.hwpx'] = new Uint8Array(await readFile(new URL('templates/blank.hwpx', root)));
files['public/shell.html'] = new Uint8Array(await readFile(new URL('shell.html', root)));
files['UPDATE.txt'] = new TextEncoder().encode('MSDS 추출/그림문자/Excel/한글 2010 호환 업데이트\n\n1. 이 ZIP을 PC의 임시 폴더에 압축 해제합니다.\n2. public/assets, public/ghs, public/vendor, public/templates의 파일을 NAS web/argo/public 아래 같은 폴더에 업로드하고 겹치는 파일은 덮어씁니다.\n3. public/.htaccess도 같은 위치에 반영하고 public/shell.html을 마지막에 교체합니다.\n4. 기존 config.php와 DB 저장 폴더는 유지합니다. 이 ZIP에는 비밀 키/DB가 없습니다.\n5. MSDS 페이지에서 Ctrl+F5로 새로고침한 뒤 원본 MSDS 파일을 다시 선택합니다. 예전 분석 목록의 추출값은 자동 변경되지 않습니다.\n6. 제품명·공급자·전화·분류·그림문자·1~16항을 원문과 확인하고 수정합니다. 그림문자는 직접 추가하거나 해제할 수 있습니다.\n7. 엑셀은 여섯 시트와 실제 GHS 그림을 확인합니다. 한글 2010은 RTF 저장 후 한글의 파일 > 불러오기로 열고 필요하면 HWP로 저장합니다. HWPX는 한글 2010 SE+ 이상용입니다.\n\n원문에 없거나 확실히 읽을 수 없는 내용은 추정해 채우지 않습니다. 지원하지 않는 그림과 스캔 문자는 수동 검토가 필요합니다.\n');
if (Object.keys(files).some(name => name.endsWith('config.php') || name.endsWith('.sqlite'))) throw Error('Unexpected private file');
await writeFile(new URL('../outputs/msds-update.zip', import.meta.url), zipSync(files, { level: 6 }));
console.log('MSDS update archive prepared with JavaScript, PNG/SVG pictograms, template and upload instructions.');
