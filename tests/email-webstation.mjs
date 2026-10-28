import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import {createServer} from 'node:net';import {randomUUID,createHmac} from 'node:crypto';import assert from 'node:assert/strict';
import {checkEmailAccounts} from './email-scenarios.mjs';
const root=process.cwd(),php=path.join(root,'.sites-runtime/php7430/php.exe'),folder=path.join(root,'.sites-runtime/tests/email-php-'+randomUUID());await mkdir(folder,{recursive:true});
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin=`http://127.0.0.1:${port}`,secret='email-php-tests-012345678901234567890123456';
const config=path.join(folder,'config.php');await writeFile(config,`<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify({app_origin:origin,auth_secret:secret,data_dir:folder+'/data',trusted_proxy_ips:[]})).toString('base64')}'),true);`);
const server=spawn(php,['-d',`extension_dir=${path.dirname(php)}/ext`,'-d','extension=php_mbstring.dll','-d','extension=php_pdo_sqlite.dll','-S',`127.0.0.1:${port}`,'-t',path.join(root,'.sites-runtime/webstation-build/public')],{env:{...process.env,ARGO_CONFIG_PATH:config},stdio:['ignore','pipe','pipe']});let logs='';server.stderr.on('data',data=>logs+=data);
const jar=new Map();let csrf='';function cookies(){return [...jar].map(([key,value])=>`${key}=${value}`).join('; ');}function absorb(response){for(const header of response.headers.getSetCookie()){const first=header.split(';')[0],index=first.indexOf('=');jar.set(first.slice(0,index),first.slice(index+1));}}
const url=route=>origin+'/index.php?'+new URLSearchParams({route});
async function status(){const response=await fetch(url('/api/account'),{headers:{cookie:cookies()},redirect:'manual'});absorb(response);assert.equal(response.status,200,await response.clone().text());const data=await response.json();csrf=data.csrf;return data;}
async function post(action,form,options={}){const response=await fetch(url('/auth/email/'+action),{method:'POST',headers:{origin:options.origin||origin,cookie:cookies()},body:new URLSearchParams({...form,_csrf:options.csrf||csrf}),redirect:'manual'});absorb(response);return response;}
try{
 for(let i=0;i<80;i++){try{if((await fetch(url('/api/health'))).ok)break;}catch{}if(i===79)throw Error(logs);await new Promise(resolve=>setTimeout(resolve,80));}
 const checks=await checkEmailAccounts({origin,logout:async()=>{jar.clear();csrf='';},status,post,member:async()=>{const response=await fetch(url('/api/page'),{headers:{cookie:cookies()}});return(await response.json()).member;}});
 // A pre-existing paid Google account sets a password only after fresh Google proof.
 const payload={type:'session',userId:'google:legacy',email:'legacy@example.test',displayName:'기존 정회원',authMethod:'google',authenticatedAt:Date.now()/1000,exp:Date.now()/1000+3600};
 function token(value){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');}
 jar.clear();jar.set('argo_session',token(payload));await status();
 const sqlFile=path.join(folder,'set-paid.php');await writeFile(sqlFile,`<?php $db=new PDO('sqlite:'.getenv('ARGO_TEST_DB'));$db->exec("UPDATE members SET role='paid',business_name='기존 사업장' WHERE user_id='google:legacy'");`);
 await new Promise((resolve,reject)=>{const process=spawn(php,['-d',`extension_dir=${path.dirname(php)}/ext`,'-d','extension=php_pdo_sqlite.dll',sqlFile],{env:{...globalThis.process.env,ARGO_TEST_DB:folder+'/data/argo.sqlite'},stdio:'ignore'});process.once('error',reject);process.once('exit',code=>code===0?resolve():reject(Error('Fixture failed')));});
 jar.set('argo_session',token({...payload,authenticatedAt:Date.now()/1000-3600}));assert.ok((await post('password',{password:'Legacy12!',confirmPassword:'Legacy12!'})).headers.get('location').includes('error=reauth'));
 jar.set('argo_session',token(payload));assert.equal((await post('password',{password:'Legacy12!',confirmPassword:'Legacy12!'})).status,303);
 jar.clear();await status();assert.equal((await post('login',{email:payload.email,password:'Legacy12!',return_to:'/members'})).status,303);
 const member=(await(await fetch(url('/api/page'),{headers:{cookie:cookies()}})).json()).member;assert.equal(member.role,'paid');assert.equal(member.userId,payload.userId);assert.equal(member.businessName,'기존 사업장');
 const outputFile=path.join(folder,'hash.php');await writeFile(outputFile,`<?php require '${root.replaceAll('\\','/')}/nas-webstation/server/credentials.php';echo account_hash('Interop12!');`);
 const hash=await new Promise((resolve,reject)=>{let text='';const process=spawn(php,['-d',`extension_dir=${path.dirname(php)}/ext`,outputFile],{stdio:['ignore','pipe','pipe']});process.stdout.on('data',data=>text+=data);process.once('exit',code=>code===0?resolve(text):reject(Error('PHP hash failed')));});
 const [kind,iterations,salt,expected]=hash.split('$');assert.equal(kind,'pbkdf2_sha256');const {pbkdf2Sync}=await import('node:crypto');assert.equal(pbkdf2Sync('Interop12!',Buffer.from(salt,'hex'),Number(iterations),32,'sha256').toString('hex'),expected);
 console.log(`${checks} PHP email HTTP checks plus legacy password proof, grade/data preservation and cross-runtime password hash verification passed.`);
}finally{const done=once(server,'exit');server.kill();await done;}
