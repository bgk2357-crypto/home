// @ts-nocheck -- integration harness supplies a real SQLite-backed runtime.
import assert from 'node:assert/strict';
import { openDatabase } from '../scripts/node-env.mjs';
import { uploadResource } from '../app/resource-actions';
import { getResources,getResource } from '../app/resource-data';
import { GET as download } from '../app/api/safety-files/route';
import { signValue } from '../app/auth/session';
import { safetyFactors } from '../app/safety-content';
import { MAX_FILE_BYTES } from '../lib/safety-resources';
globalThis.safetyEnv={DB:openDatabase(':memory:'),AUTH_SECRET:'test-only-secret-012345678901234567890123456789'};
globalThis.safetyHeaders=new Headers();
const db=globalThis.safetyEnv.DB;
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function login(id){globalThis.safetyHeaders=new Headers();if(id)globalThis.safetyHeaders.set('cookie','argo_session='+await signValue({type:'session',userId:'google:'+id,displayName:id,email:id+'@example.test',exp:Date.now()/1000+3600}));}
function form(files=[],overrides={}){const f=new FormData();for(const[k,v]of Object.entries({title:'현장 점검표',body:'<script>alert(1)</script>\n공개 안내',category:'서식',consent:'public',...overrides}))f.set(k,v);for(const[name,data]of files)f.append('files',new Blob([data]),name);return f;}
async function upload(f,origin='https://site.test'){return uploadResource(new Request('https://site.test/actions/safety-resources',{method:'POST',headers:origin?{Origin:origin}:{},body:f}));}
eq(safetyFactors.reduce((n,f)=>n+f.checks.length,0),25);
eq((await getResources()).total,3);
eq((await upload(form())).status,401);
await login('A');eq((await upload(form())).status,403);
await db.prepare("UPDATE members SET display_name='등록회원A',role='general',business_name='테스트 사업장',business_size='20~49인',contact_name='담당자',job_title='과장',phone='010-0000-0000' WHERE user_id=?").bind('google:A').run();
eq((await upload(form(),'https://evil.test')).status,403);eq((await upload(form(),null)).status,403);
const pdf=new Uint8Array(1100000);pdf.set(new TextEncoder().encode('%PDF-1.7\nchunk test'));
let r=await upload(form([['점검표.pdf',pdf]]));eq(r.status,303);assert.match(r.headers.get('location'),/saved=1/);checks++;
const id=new URL(r.headers.get('location')).searchParams.get('post');let post=await getResource(id);eq(post.author,'등록회원A');eq(post.files.length,1);eq(post.body,'<script>alert(1)</script>\n공개 안내');
let bytes=await download(new Request('https://site.test/api/safety-files?file='+post.files[0].id));eq(bytes.status,200);eq(bytes.headers.get('content-type'),'application/octet-stream');eq(new Uint8Array(await bytes.arrayBuffer()),pdf);
eq((await getResources(1,'현장','서식')).total,1);eq((await getResources(1,'없음')).total,0);eq((await getResources(1,'','가이드')).total,1);
for(const files of [[['bad.php','<?php']], [['fake.pdf','not pdf']], Array.from({length:4},(_,i)=>[i+'.txt','text']), [['big.txt',new Uint8Array(MAX_FILE_BYTES+1)]]]){r=await upload(form(files));assert.match(r.headers.get('location'),/error=file/);checks++;}
eq((await getResources()).total,4);
r=await upload(form([],{body:' ',title:'valid'}));assert.match(r.headers.get('location'),/error=invalid/);checks++;
r=await upload(form([],{consent:''}));assert.match(r.headers.get('location'),/error=invalid/);checks++;
r=await upload(form([],{title:'자료 안내만 등록'}));eq(r.status,303);eq((await getResource(new URL(r.headers.get('location')).searchParams.get('post'))).files.length,0);
eq((await download(new Request('https://site.test/api/safety-files?file=../../bad'))).status,404);
eq((await download(new Request('https://site.test/api/safety-files?file=missing'))).status,404);
for(let i=0;i<10;i++)await upload(form([],{title:'페이지 '+i}));eq((await getResources()).pages,2);eq((await getResources(99)).current,2);
const original=db.batch;db.batch=async()=>{throw Error('simulate chunk failure');};r=await upload(form([['failure.txt','text']]));assert.match(r.headers.get('location'),/error=busy/);checks++;db.batch=original;
eq((await getResources(1,'failure')).total,0);
db.close();console.log(`${checks} Node resource checks passed: session/member authorization, 25 reference questions, upload validation, chunk roundtrip, search/filter/pagination, publication and rollback.`);
