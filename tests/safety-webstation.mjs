import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:net';
const root=process.cwd(),php=process.env.PHP_BIN||'C:/home/.sites-runtime/php7430/php.exe';
const args=process.platform==='win32'?['-d',`extension_dir=${path.dirname(php)}/ext`,'-d','extension=php_mbstring.dll','-d','extension=php_pdo_sqlite.dll','-d','upload_max_filesize=5M','-d','post_max_size=16M']:[];
const folder=path.resolve('.sites-runtime/tests/safety-'+randomUUID());await mkdir(folder,{recursive:true});
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const origin=`http://127.0.0.1:${port}`,secret=randomBytes(32).toString('hex');
const configuration={app_origin:origin,auth_secret:secret,data_dir:folder+'/data',google_client_id:'',google_client_secret:'',trusted_proxy_ips:[]};
const configPath=folder+'/config.php';await writeFile(configPath,`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(configuration)).toString('base64')}'),true);`);
const env={...process.env,ARGO_CONFIG_PATH:configPath,ARGO_SERVER_ROOT:root+'/outputs/synology-webstation/server'};
let child,logs='',checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
for(const f of ['bootstrap.php','routes.php','resources.php']){const r=spawnSync(php,[...args,'-l',root+'/outputs/synology-webstation/server/'+f],{encoding:'utf8',env});eq(r.status,0);}
const route=(name,query={})=>origin+'/index.php?'+new URLSearchParams({route:name,...query});
async function launch(){child=spawn(php,[...args,'-S',`127.0.0.1:${port}`,'-t',root+'/outputs/synology-webstation/public'],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);for(let i=0;i<60;i++){try{if((await fetch(route('/api/health'))).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(logs);}
async function stop(){if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}}
function session(id){const p=Buffer.from(JSON.stringify({type:'session',userId:'google:'+id,email:id+'@example.test',displayName:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');}
let csrf='';const cookies=id=>'argo_csrf='+csrf+(id?'; argo_session='+session(id):'');
async function page(query={},id){return (await fetch(route('/api/page',{path:'/resources/safety-forms',...query}),{headers:{Cookie:cookies(id)}})).json();}
function form(files=[],extra={}){const f=new FormData();for(const[k,v]of Object.entries({_csrf:csrf,title:'안전 점검표',body:'한글 자료\n<script>escaped</script>',category:'서식',consent:'public',...extra}))f.set(k,v);for(const[name,bytes]of files)f.append('files[]',new Blob([bytes]),name);return f;}
async function upload(files=[],id='A',extra={},originHeader=origin){return fetch(route('/actions/safety-resources'),{method:'POST',headers:{Origin:originHeader,Cookie:cookies(id)},body:form(files,extra),redirect:'manual'});}
try{
 await launch();const first=await page();csrf=first.csrf;eq(first.resources.total,3);
 eq((await upload([],null)).status,401);eq((await upload([],'A')).status,403);
 let r=await fetch(route('/actions/join'),{method:'POST',headers:{Origin:origin,Cookie:cookies('A')},body:new URLSearchParams({_csrf:csrf,displayName:'회원A',businessName:'테스트 사업장',businessSize:'20~49인',contactName:'담당자',jobTitle:'과장',phone:'010-0000-0000',consent:'yes'}),redirect:'manual'});eq(r.status,303);
 eq((await upload([],'A',{},'https://evil.test')).status,403);eq((await upload([],'A',{_csrf:'wrong'})).status,403);
 const pdf=Buffer.alloc(1100000);pdf.write('%PDF-1.7\nfile test');r=await upload([['현장.pdf',pdf]]);eq(r.status,303);assert.match(r.headers.get('location'),/saved=1/);checks++;
 const id=new URL(r.headers.get('location'),origin).searchParams.get('post');let selected=(await page({post:id})).resourceSelected;eq(selected.author,'회원A');eq(selected.files.length,1);eq(selected.body,'한글 자료\n<script>escaped</script>');
 const fid=selected.files[0].id;let file=await fetch(route('/api/safety-files',{file:fid}));eq(file.status,200);eq(file.headers.get('content-type'),'application/octet-stream');eq(Buffer.from(await file.arrayBuffer()),pdf);
 eq((await page({q:'점검표',category:'서식'})).resources.total,1);eq((await page({q:'없는검색'})).resources.total,0);
 eq((await fetch(route('/api/safety-files',{file:'starter-guide-pdf'}),{redirect:'manual'})).headers.get('location'),'/safety/guide.pdf');
 eq((await fetch(origin+'/safety/guide.pdf')).status,200);eq((await fetch(origin+'/safety/seven-checklist.png')).status,200);
 for(const files of [[['bad.php','<?php']], [['bad.pdf','fake']], Array.from({length:4},(_,i)=>[i+'.txt','text']), [['large.txt',Buffer.alloc(5*1024*1024+1,65)]]]){r=await upload(files);assert.match(r.headers.get('location'),/error=file/);checks++;}
 eq((await page()).resources.total,4);
 r=await upload([],'A',{title:' ',body:' '});assert.match(r.headers.get('location'),/error=invalid/);checks++;
 r=await upload([],'A',{consent:''});assert.match(r.headers.get('location'),/error=invalid/);checks++;
 eq((await upload([],'A',{title:'첨부 없는 안내'})).status,303);
 for(let i=0;i<7;i++)eq((await upload([],'A',{title:'목록 '+i})).status,303);
 eq((await page()).resources.pages,2);eq((await page({page:'999'})).resources.current,2);
 eq((await fetch(route('/api/safety-files',{file:'../../x'}))).status,404);
 await stop();await launch();selected=(await page({post:id})).resourceSelected;eq(selected.files[0].id,fid);file=await fetch(route('/api/safety-files',{file:fid}));eq(Buffer.from(await file.arrayBuffer()),pdf);
 console.log(`${checks} PHP resource checks passed: real multipart upload, CSRF/session/membership, chunk bytes, DB restart persistence, search/filter/pages, seed downloads, invalid files and size limits.`);
}finally{await stop();}
