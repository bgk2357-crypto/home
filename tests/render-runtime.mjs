import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
import { openDatabase } from '../scripts/node-env.mjs';
import { DatabaseSync } from 'node:sqlite';

const databasePath = path.resolve('.sites-runtime/tests/render-'+randomUUID()+'.sqlite');
let database = openDatabase(databasePath);
await database.prepare('INSERT INTO guestbook(author,body,created_at) VALUES (?,?,?)').bind('동작 검증','persisted','2026-10-23').run();
database.close(); database = openDatabase(databasePath);
assert.equal(await database.prepare('SELECT COUNT(*) AS total FROM guestbook').first('total'),1);
assert.deepEqual(await database.prepare('SELECT author,body FROM guestbook').raw(),[['동작 검증','persisted']]);
const probe = new DatabaseSync(':memory:');
const prototype = Object.getPrototypeOf(probe.prepare('SELECT 1'));
const nativeSetReturnArrays = prototype.setReturnArrays;
try {
  prototype.setReturnArrays = undefined;
  assert.deepEqual(await database.prepare('SELECT author,body FROM guestbook').raw(),[['동작 검증','persisted']]);
} finally { prototype.setReturnArrays = nativeSetReturnArrays; probe.close(); }
database.close();
await build({entryPoints:['lib/industrial-statistics.ts'],outfile:'.sites-runtime/tests/statistics.mjs',bundle:true,platform:'node',format:'esm'});
const {INDUSTRIAL_STATISTICS:rows,poisoningTotal,musculoskeletalTotal}=await import('../.sites-runtime/tests/statistics.mjs');
for(const row of rows){assert.equal(row.accidentVictims+row.diseaseVictims,row.casualties);assert.equal(row.accidentDeaths+row.diseaseDeaths,row.deaths);}
assert.deepEqual(rows.map(poisoningTotal),[272,241,259]);
assert.deepEqual(rows.map(musculoskeletalTotal),[13010,16267,22145]);
assert.equal(rows.at(-1).cases,null);

const port=5191,base=`http://localhost:${port}`;let child,logs='';
async function launch(){
  child=spawn(process.execPath,['scripts/start-node.mjs'],{env:{...process.env,PORT:String(port),RENDER:'true',SQLITE_PATH:databasePath},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null)throw Error(logs);
    try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Production server not ready: '+logs);
}
async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
async function submit(action,values,extra={}){return fetch(base+'/actions/'+action,{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams(values),redirect:'manual'});}
try{
  await launch();
  let r=await fetch(base+'/');let html=await r.text();assert.equal(r.status,200);assert.ok(!html.includes('id="industrial-statistics-title"'));
  html=await(await fetch(base+'/news/statistics')).text();assert.ok(html.includes('연도별 산업재해 통계'));assert.ok(html.includes('147,130'));assert.ok(html.includes('미수록'));
  html=await(await fetch(base+'/resources/msds')).text();assert.ok(html.includes('MSDS 분석'));assert.ok(html.includes('msds-files'));assert.ok(html.includes('.hwp'));
  assert.equal((await fetch(base+'/vendor/pdf.worker.min.mjs')).status,200);assert.equal((await fetch(base+'/ghs/GHS02.svg')).status,200);
  r=await fetch(base+'/community?write=1');html=await r.text();assert.ok(html.includes('name="author"'));assert.ok(html.includes('비회원 글쓰기'));assert.ok(!html.includes('로그인 후 글쓰기'));
  r=await submit('guestbook',{author:'Render 확인',body:'render-guestbook-persistence'});assert.equal(r.status,303);assert.ok(r.headers.get('location').endsWith('?saved=1'));
  r=await submit('community',{author:'비회원 확인',title:'render-anonymous-title',body:'<script>test-only</script>'});assert.equal(r.status,303);assert.ok(r.headers.get('location').endsWith('?saved=1'));
  r=await submit('community',{author:'   ',title:'invalid',body:'invalid'});assert.ok(r.headers.get('location').endsWith('?error=invalid'));
  r=await submit('community',{author:'spoof',title:'spoof',body:'spoof'},{Origin:'https://evil.test'});assert.equal(r.status,403);
  r=await submit('qna',{title:'private',body:'requires-auth'});assert.equal(r.status,401);
  r=await submit('guestbook',{author:'Proxy 확인',body:'https-proxy-write'},{Origin:'https://localhost:'+port,'X-Forwarded-Proto':'https'});assert.equal(r.status,303);assert.equal(new URL(r.headers.get('location')).protocol,'https:');
  html=await(await fetch(base+'/community')).text();assert.ok(html.includes('render-anonymous-title'));
  await stop();await launch();
  html=await(await fetch(base+'/community')).text();assert.ok(html.includes('render-anonymous-title'));
  html=await(await fetch(base+'/guestbook')).text();assert.ok(html.includes('render-guestbook-persistence'));
  console.log('Render Node production checks passed: SQLite migrations/reopen, anonymous posts, validation, Q&A protection, HTTPS proxy, persistence across server restart, homepage statistics and verified category totals.');
}finally{await stop();}
