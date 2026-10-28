import {readdir,lstat,realpath,readFile,writeFile,mkdir,rename,unlink,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';
import {zipPayloadHash} from './deployment-output.mjs';

const root=await realpath(fileURLToPath(new URL('../outputs/',import.meta.url)));
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const dateOf=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
function inside(value){const resolved=path.resolve(value);if(!resolved.startsWith(root+path.sep))throw Error(`Outside HOME outputs: ${resolved}`);return resolved;}
const entries=[];
async function record(source,day,dated){
 inside(source);const info=await lstat(source);if(info.isSymbolicLink())throw Error(`Symbolic link requires separate handling: ${source}`);
 const name=path.basename(source),ext=info.isDirectory()?'':name.endsWith('.tar.gz')?'.tar.gz':path.extname(name);
 entries.push({source,day:day||dateOf(info.mtime),dated,name,ext,stem:ext?name.slice(0,-ext.length):name,directory:info.isDirectory(),time:info.mtimeMs,...(!info.isDirectory()&&ext.toLowerCase()==='.zip'?{hash:zipPayloadHash(unzipSync(await readFile(source)))}:{})});
}
for(const entry of await readdir(root,{withFileTypes:true})){
 const source=path.join(root,entry.name);
 if(entry.isDirectory()&&datePattern.test(entry.name)){for(const child of await readdir(source))await record(path.join(source,child),entry.name,true);}
 else await record(source,null,false);
}
if(entries.some(entry=>entry.dated&&entry.directory&&['텍스트','ZIP','압축풀기','이미지','기타'].includes(entry.name)))throw Error('Historical migration is already complete. Use the current guide and deployment-output.mjs; do not renumber category folders.');
// Keep one byte-identical ZIP, preferring the copy already in a dated folder.
const hashes=new Map(),duplicates=[];
for(const entry of [...entries].sort((a,b)=>Number(b.dated)-Number(a.dated)||a.time-b.time||a.name.localeCompare(b.name))){
 if(!entry.hash)continue;
 if(hashes.has(entry.hash)){entry.duplicateOf=hashes.get(entry.hash);duplicates.push(entry);}else hashes.set(entry.hash,entry);
}
const byDay=new Map();
for(const entry of entries.filter(item=>!item.duplicateOf)){const list=byDay.get(entry.day)||[];list.push(entry);byDay.set(entry.day,list);}
const occupied=new Set();
for(const [day,list]of byDay){
 const groups=new Map();
 for(const entry of list){const group=groups.get(entry.stem)||{items:[],time:entry.time};group.items.push(entry);group.time=Math.min(group.time,entry.time);if(entry.hash)group.time=entry.time;groups.set(entry.stem,group);}
 let revision=0;
 for(const [stem,group]of [...groups].sort((a,b)=>a[1].time-b[1].time||a[0].localeCompare(b[0]))){
  revision++;
  const base=stem.replace(/_\d{4}-\d{2}-\d{2}_\d+차수정$/,'');
  for(const entry of group.items.sort((a,b)=>Number(b.dated)-Number(a.dated))){
   let tag='',counter=0,destination;
   do{destination=inside(path.join(root,day,`${base}${tag}_${day}_${revision}차수정${entry.ext}`));tag=`_원본보관${++counter}`;}while(occupied.has(destination));
   occupied.add(destination);entry.destination=destination;entry.revision=revision;
  }
 }
}
const plan={dateBasis:'기존 날짜 폴더를 우선하고 그 외에는 원본 수정 시각(한국 날짜) 기준. 차수는 남아 있는 항목의 수정 시각 순서로 소급 부여.',hashBasis:'ZIP 내부 파일 이름과 내용의 SHA256. ZIP 시각과 압축률은 제외.',moves:entries.filter(item=>!item.duplicateOf).map(({source,destination,hash})=>({source,destination,payloadSha256:hash})),removedDuplicateZips:duplicates.map(item=>({source:item.source,retained:item.duplicateOf.destination,payloadSha256:item.hash}))};
const planPath=fileURLToPath(new URL('../.sites-runtime/outputs-organization-plan.json',import.meta.url));
await mkdir(path.dirname(planPath),{recursive:true});await writeFile(planPath,JSON.stringify(plan,null,2));
console.log(JSON.stringify({moves:plan.moves.length,duplicateZips:duplicates.length,dates:[...byDay.keys()].sort(),plan:planPath}));
if(!process.argv.includes('--apply'))process.exit(0);
// Resolve and validate all targets before any move or deletion. Never overwrite.
for(const move of plan.moves){inside(await realpath(move.source));inside(move.destination);try{await access(move.destination);if(move.destination!==move.source)throw Error(`Destination already exists: ${move.destination}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const move of plan.moves){if(move.source===move.destination)continue;await mkdir(path.dirname(move.destination),{recursive:true});await rename(move.source,move.destination);}
for(const duplicate of plan.removedDuplicateZips){
 inside(await realpath(duplicate.source));inside(await realpath(duplicate.retained));
 if(zipPayloadHash(unzipSync(await readFile(duplicate.source)))!==duplicate.payloadSha256||zipPayloadHash(unzipSync(await readFile(duplicate.retained)))!==duplicate.payloadSha256)throw Error('ZIP changed; deletion cancelled');
 await unlink(duplicate.source);
}
const today=dateOf(new Date());await mkdir(path.join(root,today),{recursive:true});
await writeFile(path.join(root,today,`배포파일_정리기록_${today}_1차수정.json`),JSON.stringify(plan,null,2),{flag:'wx'});
const top=await readdir(root,{withFileTypes:true});if(top.some(item=>!item.isDirectory()||!datePattern.test(item.name)))throw Error('Unexpected item remains in outputs root');
const finalHashes=new Set();let zipCount=0;
for(const date of top)for(const entry of await readdir(path.join(root,date.name),{withFileTypes:true})){if(entry.isFile()&&entry.name.endsWith('.zip')){const hash=zipPayloadHash(unzipSync(await readFile(path.join(root,date.name,entry.name))));if(finalHashes.has(hash))throw Error('Duplicate ZIP remains');finalHashes.add(hash);zipCount++;}}
console.log(`Verified: outputs contains only date folders; ${zipCount} distinct ZIPs remain.`);
