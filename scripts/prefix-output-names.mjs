import {readdir,realpath,lstat,access,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {deploymentRoot,revisionPrefix,koreanDay} from './deployment-output.mjs';
const root=await realpath(deploymentRoot),plan=[];
function checked(value){const absolute=path.resolve(value);if(!absolute.startsWith(root+path.sep))throw Error('Outside HOME outputs');return absolute;}
for(const day of await readdir(root,{withFileTypes:true})){
 if(!day.isDirectory()||!/^\d{4}-\d{2}-\d{2}$/.test(day.name))continue;
 for(const category of await readdir(path.join(root,day.name),{withFileTypes:true})){
  if(!category.isDirectory())continue;
  const folder=path.join(root,day.name,category.name);
  for(const item of await readdir(folder,{withFileTypes:true})){
   const match=item.name.match(/^(.*)_(\d{4}-\d{2}-\d{2})_(\d+)차수정(\.[^.]+(?:\.gz)?)?$/);
   if(!match)continue;
   const destination=checked(path.join(folder,`${revisionPrefix(match[2],Number(match[3]))}_${match[1]}${match[4]||''}`));
   const source=checked(path.join(folder,item.name));
   if((await lstat(source)).isSymbolicLink())throw Error('Unexpected symbolic link');
   plan.push({source,destination});
  }
 }
}
const targets=new Set();
for(const item of plan){checked(await realpath(item.source));if(targets.has(item.destination))throw Error('Duplicate rename target');targets.add(item.destination);try{await access(item.destination);throw Error('Rename target exists');}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const item of plan)await rename(item.source,item.destination);
const today=koreanDay();await writeFile(path.join(root,today,'텍스트',`${revisionPrefix(today,13)}_날짜차수_앞배치_이동기록.json`),JSON.stringify({scope:'보관 결과물만 변경. 배포본 내부 파일명과 ZIP 내용은 유지.',moves:plan},null,2),{flag:'wx'});
console.log(`Renamed ${plan.length} archived items with date and padded revision first.`);
