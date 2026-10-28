import {readdir,mkdir,rename,realpath,access,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {deploymentRoot,koreanDay,revisionPrefix,requestedDeploymentRevision} from './deployment-output.mjs';
const assignedRevision=requestedDeploymentRevision();
if(assignedRevision===null)throw Error('Pass --revision N assigned to this user request.');
const root=await realpath(deploymentRoot),moves=[];
const categories=new Set(['텍스트','ZIP','압축풀기','이미지','기타']);
function checked(value){const absolute=path.resolve(value);if(!absolute.startsWith(root+path.sep))throw Error(`Outside HOME outputs: ${absolute}`);return absolute;}
async function move(source,destination){
 checked(await realpath(source));checked(destination);
 try{await access(destination);throw Error(`Target exists: ${destination}`);}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(path.dirname(destination),{recursive:true});await rename(source,destination);moves.push({source,destination});
}
for(const date of await readdir(root,{withFileTypes:true})){
 if(!date.isDirectory()||!/^\d{4}-\d{2}-\d{2}$/.test(date.name))continue;
 const daily=path.join(root,date.name);
 await Promise.all(['텍스트','ZIP','압축풀기'].map(name=>mkdir(path.join(daily,name),{recursive:true})));
 for(const entry of await readdir(daily,{withFileTypes:true})){
  if(entry.isSymbolicLink())throw Error('Unexpected symbolic link');
  if(entry.isDirectory()&&categories.has(entry.name))continue;
  const category=entry.isDirectory()?'압축풀기':/\.(zip|tar\.gz|7z|rar)$/i.test(entry.name)?'ZIP':/\.(txt|md|json|csv|tsv|log)$/i.test(entry.name)?'텍스트':/\.(png|jpe?g|webp|gif|svg)$/i.test(entry.name)?'이미지':'기타';
  await move(path.join(daily,entry.name),path.join(daily,category,entry.name));
 }
 // Old backup archives are standalone ZIP deliverables, not application files.
 async function gatherZips(folder){for(const entry of await readdir(folder,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Unexpected symbolic link');const full=path.join(folder,entry.name);if(entry.isDirectory())await gatherZips(full);else if(entry.name.endsWith('.zip'))await move(full,path.join(daily,'ZIP',entry.name));}}
 await gatherZips(path.join(daily,'압축풀기'));
}
if(moves.length){
 const day=koreanDay(),daily=path.join(root,day),text=path.join(daily,'텍스트');await mkdir(text,{recursive:true});
 await writeFile(path.join(text,`${revisionPrefix(day,assignedRevision)}_종류별_이동기록.json`),JSON.stringify({moves},null,2),{flag:'wx'});
}
console.log(`Categorized ${moves.length} items; original payload files and application paths retained.`);
