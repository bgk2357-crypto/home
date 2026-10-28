import {readdir,readFile,writeFile,rename,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {deploymentRoot,zipPayloadHash,koreanDay,revisionPrefix,requestedDeploymentRevision} from './deployment-output.mjs';
import {unzipSync} from 'fflate';
const assignedRevision=requestedDeploymentRevision();
if(assignedRevision===null)throw Error('Pass --revision N assigned to this user request.');
const root=await realpath(deploymentRoot),zips=[];
function checked(value){const absolute=path.resolve(value);if(!absolute.startsWith(root+path.sep))throw Error('Outside HOME outputs');return absolute;}
async function scan(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const full=checked(path.join(folder,entry.name));if(entry.isSymbolicLink())throw Error('Unexpected symbolic link');if(entry.isDirectory())await scan(full);else if(entry.name.endsWith('.zip'))zips.push({path:full,hash:zipPayloadHash(unzipSync(await readFile(full)))});}}
await scan(root);
const kept=new Map(),removed=[],renamed=[];
for(const entry of zips.sort((a,b)=>a.path.split(path.sep).length-b.path.split(path.sep).length||a.path.localeCompare(b.path))){
 if(kept.has(entry.hash)){
  const retained=kept.get(entry.hash);
  checked(await realpath(entry.path));checked(await realpath(retained));
  if(zipPayloadHash(unzipSync(await readFile(retained)))!==entry.hash)throw Error('Retained ZIP changed');
  await unlink(entry.path);removed.push({removed:entry.path,retained,payloadSha256:entry.hash});continue;
 }
 let destination=entry.path;
 if(!/^\d{4}-\d{2}-\d{2}_\d+차수정_/.test(path.basename(entry.path))){
  const parts=path.relative(root,entry.path).split(path.sep),day=parts[0];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Missing date directory');
  const revision=assignedRevision;
  destination=checked(path.join(path.dirname(entry.path),`${revisionPrefix(day,revision)}_${path.basename(entry.path,'.zip')}.zip`));
  const siblings=await readdir(path.dirname(destination));if(siblings.includes(path.basename(destination)))throw Error('Rename target exists');
  checked(await realpath(entry.path));await rename(entry.path,destination);renamed.push({source:entry.path,destination});
 }
 kept.set(entry.hash,destination);
}
const day=koreanDay();if(removed.length||renamed.length)await writeFile(path.join(root,day,'텍스트',`${revisionPrefix(day,assignedRevision)}_배포ZIP_중첩폴더_정리기록.json`),JSON.stringify({removed,renamed,remainingZipCount:kept.size},null,2),{flag:'wx'});
console.log(JSON.stringify({removed:removed.length,renamed:renamed.length,remainingZipCount:kept.size}));
