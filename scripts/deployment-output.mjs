import {mkdir,readdir,readFile,writeFile,unlink,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {zipSync,unzipSync} from 'fflate';

export const deploymentRoot=fileURLToPath(new URL('../outputs/',import.meta.url));
export function koreanDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function revisionPrefix(day,revision){return `${day}_${String(revision).padStart(3,'0')}차수정`;}
export function nextDeploymentRevision(names,day){
 const revisions=names.filter(name=>name.toLowerCase().endsWith('.zip')||/_요청기록\.json$/.test(name)).flatMap(name=>{
  const match=name.match(/^(\d{4}-\d{2}-\d{2})_(\d+)차수정_/)||name.match(/_(\d{4}-\d{2}-\d{2})_(\d+)차수정\.zip$/i);
  return match&&match[1]===day?[Number(match[2])]:[];
 });
 return Math.max(0,...revisions)+1;
}
export function requestedDeploymentRevision(args=process.argv.slice(2)){
 const index=args.indexOf('--revision');
 if(index<0)return null;
 const raw=args[index+1];
 if(!raw||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)throw Error('--revision must be a positive integer assigned to one user request.');
 return Number(raw);
}
export function zipPayloadHash(files){
 const hash=createHash('sha256');
 for(const name of Object.keys(files).filter(name=>!name.endsWith('/')).sort()){
  hash.update(JSON.stringify([name,files[name].length]));hash.update(files[name]);
 }
 return hash.digest('hex');
}
export async function saveDeployment({name,files,guide}){
 const day=koreanDay(),daily=path.join(deploymentRoot,day);
 const zipFolder=path.join(daily,'ZIP'),textFolder=path.join(daily,'텍스트'),unpackedFolder=path.join(daily,'압축풀기');
 await Promise.all([zipFolder,textFolder,unpackedFolder].map(folder=>mkdir(folder,{recursive:true})));
 const revision=requestedDeploymentRevision();
 if(revision===null)throw Error('Assign a revision to this user message and run with --revision N. Later user follow-ups require the next revision.');
 const prefix=revisionPrefix(day,revision);
 async function recordRequest(result){
  const record=path.join(textFolder,`${prefix}_요청기록.json`);
  try{await writeFile(record,JSON.stringify({date:day,revision,summary:name,createdAt:new Date().toISOString(),...result},null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
 }
 // Compare actual file contents, independent of ZIP timestamps/compression.
 const payloadHash=zipPayloadHash(files);
 for(const date of await readdir(deploymentRoot,{withFileTypes:true})){
  if(!date.isDirectory()||!/^\d{4}-\d{2}-\d{2}$/.test(date.name))continue;
  const folder=path.join(deploymentRoot,date.name,'ZIP');
  let archivedEntries;try{archivedEntries=await readdir(folder,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
  for(const entry of archivedEntries){
   if(!entry.isFile()||!entry.name.endsWith('.zip'))continue;
   const existing=path.join(folder,entry.name);
   if(zipPayloadHash(unzipSync(await readFile(existing)))===payloadHash){await recordRequest({zip:existing,reused:true});console.log(`Identical deployment already saved: ${existing}`);return {zip:existing,reused:true};}
  }
 }
 // Multiple items in one message share a revision; later user follow-ups get the next one.
 const base=`${prefix}_${name}`,unpacked=path.join(unpackedFolder,base);
 const zip=path.join(zipFolder,`${base}.zip`),instructions=path.join(textFolder,`${prefix}_${name}_적용안내.txt`);
 const update=process.argv.includes('--update-same-request');
 // Updating unfinished work requires an explicit same-request flag, never a new revision.
 let previous={};
 try{previous=unzipSync(await readFile(zip));if(!update)throw Error('This request revision already exists. To rebuild the same request use --update-same-request; do not increment the revision.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(unpacked,{recursive:update});
 // Only remove obsolete generated files listed in this request's prior ZIP.
 for(const relative of Object.keys(previous).filter(relative=>!relative.endsWith('/')&&!(relative in files))){
  const destination=path.resolve(unpacked,relative);
  if(!destination.startsWith(unpacked+path.sep))throw Error(`Unsafe prior deployment path: ${relative}`);
  try{if(!(await lstat(destination)).isFile())throw Error('Unexpected prior deployment file type');await unlink(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 for(const [relative,content] of Object.entries(files)){
  const destination=path.resolve(unpacked,relative);
  if(!destination.startsWith(unpacked+path.sep))throw Error(`Unsafe deployment path: ${relative}`);
  if(relative.endsWith('/')){await mkdir(destination,{recursive:true});continue;}
  await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,content);
 }
 await writeFile(zip,zipSync(files,{level:6}),{flag:update?'w':'wx'});
 await writeFile(instructions,guide||[
  `${day} HOME NAS 배포본 · ${revision}차수정`,
  '같은 이름의 ZIP과 폴더는 동일한 배포 내용입니다.',
  '1. 기존 NAS web/argo 및 argo-homepage-data 백업.',
  '2. public 안의 내용을 NAS web/argo/public에 덮어쓰기.',
  '3. server 안의 내용을 NAS web/argo/server에 덮어쓰기.',
  '4. 기존 config.php 및 argo-homepage-data 유지.',
  '5. 서비스 재개 후 Ctrl+F5로 새로고침.',
 ].join('\r\n'),{flag:update?'w':'wx'});
 await recordRequest({zip,unpacked,reused:false});
 console.log(`Deployment saved: ${zip}`);return {zip,unpacked,revision,reused:false};
}
