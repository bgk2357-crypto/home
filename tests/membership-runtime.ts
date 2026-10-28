// @ts-nocheck -- isolated integration runtime, real SQLite with signed test sessions.
import assert from 'node:assert/strict';
import {openDatabase} from '../scripts/node-env.mjs';
import {getUser} from '../app/auth';
import {getMember,getPosts} from '../app/data';
import {memberAction} from '../app/member-actions';
import {POST as postAction} from '../app/actions/[action]/route';
import {uploadResource} from '../app/resource-actions';
import {signValue} from '../app/auth/session';
import {getMemberAdmin,getMemberRequests} from '../app/member-store';
globalThis.safetyEnv={DB:openDatabase(':memory:'),AUTH_SECRET:'test-member-secret-012345678901234567890123456'};globalThis.safetyHeaders=new Headers();
const db=globalThis.safetyEnv.DB;let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function login(id,email=id+'@example.test') {globalThis.safetyHeaders=new Headers();if(id)globalThis.safetyHeaders.set('cookie','argo_session='+await signValue({type:'session',userId:'google:'+id,email,displayName:'Google '+id,exp:Date.now()/1000+3600}));return getUser();}
async function act(action,values={},origin='https://site.test'){return memberAction(new Request('https://site.test/actions/'+action,{method:'POST',headers:origin?{Origin:origin}:{},body:new URLSearchParams(values)}),action);}
async function write(kind,values){return postAction(new Request('https://site.test/actions/'+kind,{method:'POST',headers:{Origin:'https://site.test',cookie:globalThis.safetyHeaders.get('cookie')||''},body:new URLSearchParams(values)}),{params:Promise.resolve({action:kind})});}
const profile={displayName:'담당자 A',businessName:'테스트 사업장',businessSize:'20~49인',contactName:'김담당',jobTitle:'안전담당 / 과장',phone:'010-1234-5678',consent:'yes'};
const redirect=(r,key)=>{assert.match(r.headers.get('location')||'',new RegExp(key));checks++;};
await login(null);eq((await act('member-profile',profile)).status,401);
await login('A');let member=await getMember('google:A');eq(member.role,'preliminary');eq(member.email,'A@example.test'.toLowerCase());
eq((await write('community',{title:'차단',body:'예비회원'})).status,403);eq((await write('qna',{title:'차단',body:'예비회원'})).status,403);
let f=new FormData();f.set('title','자료');f.set('body','본문');f.set('category','서식');f.set('consent','public');eq((await uploadResource(new Request('https://site.test/actions/safety-resources',{method:'POST',headers:{Origin:'https://site.test'},body:f}))).status,403);
eq((await act('admin-grade',{userId:'google:A',role:'master'})).status,403);eq((await act('paid-request',{note:'신청',consent:'yes'})).status,403);
for(const field of ['businessName','businessSize','contactName','jobTitle','phone']){redirect(await act('member-profile',{...profile,[field]:''}),'error=invalid');eq((await getMember('google:A')).role,'preliminary');}
redirect(await act('member-profile',{...profile,phone:'abc'}),'error=invalid');redirect(await act('member-profile',{...profile,businessSize:'invalid'}),'error=invalid');
eq((await act('member-profile',profile,'https://evil.test')).status,403);eq((await act('member-profile',profile,null)).status,403);
redirect(await act('member-profile',{...profile,role:'master',userId:'google:OWNER'}),'saved=profile');member=await getMember('google:A');eq(member.role,'general');eq(member.businessName,'테스트 사업장');eq(await getMember('google:OWNER'),null);
eq((await write('community',{title:'일반회원 글',body:'본문',author:'가짜작성자'})).status,303);eq((await getPosts('community',1)).items[0].author,'담당자 A');
eq((await write('qna',{title:'A 비공개',body:'A 문의'})).status,303);eq((await getPosts('qna',1,'google:A')).total,1);
await login('B');redirect(await act('member-profile',{...profile,displayName:'담당자B'}),'saved=profile');eq((await getPosts('qna',1,'google:B')).total,0);
await login('OWNER','bgk2357@gmail.com');eq((await getMember('google:OWNER')).role,'master');eq((await getPosts('qna',1,'google:OWNER')).total,1);
const qna=(await getPosts('qna',1,'google:OWNER')).items[0];redirect(await act('qna-answer',{postId:String(qna.id),answer:'운영자 답변'}),'saved=1');
await login('A');eq((await getPosts('qna',1,'google:A')).items[0].answer,'운영자 답변');eq((await act('qna-answer',{postId:String(qna.id),answer:'위조'})).status,403);
redirect(await act('paid-request',{note:'입금 확인 요청',consent:'yes'}),'saved=request');redirect(await act('paid-request',{note:'중복',consent:'yes'}),'saved=request');let requests=await getMemberRequests('google:A');eq(requests.length,1);eq((await getMember('google:A')).role,'general');const request=requests[0];
eq((await act('admin-paid-review',{userId:'google:A',requestId:request.id,decision:'approve'})).status,403);
await login('OWNER','bgk2357@gmail.com');member=await getMember('google:A');let review={userId:member.userId,version:String(member.version),requestId:request.id,decision:'approve',reason:'입금 확인'};
redirect(await act('admin-paid-review',review),'error=payment');eq((await getMember('google:A')).role,'general');
review={...review,paymentConfirmed:'yes',amount:'10000',paymentReference:'테스트 입금 확인'};redirect(await act('admin-paid-review',review),'saved=1');eq((await getMember('google:A')).role,'paid');eq((await getMemberRequests('google:A'))[0].status,'approved');
redirect(await act('admin-paid-review',review),'error=stale');
await login('A');redirect(await act('member-profile',{...profile,jobTitle:'팀장',role:'master'}),'saved=profile');eq((await getMember('google:A')).role,'paid');
await login('OWNER','bgk2357@gmail.com');member=await getMember('google:A');const staleVersion=String(member.version);redirect(await act('admin-grade',{userId:member.userId,version:staleVersion,role:'preliminary',reason:'정보 확인 필요'}),'saved=1');
await login('A');eq((await write('community',{title:'강등 후 차단',body:'본문'})).status,403);
await login('OWNER','bgk2357@gmail.com');redirect(await act('admin-grade',{userId:'google:A',version:staleVersion,role:'master',reason:'오래된 요청',confirmMaster:'yes'}),'error=stale');
const owner=await getMember('google:OWNER');redirect(await act('admin-grade',{userId:owner.userId,version:String(owner.version),role:'general',reason:'오인 강등'}),'error=owner');
member=await getMember('google:B');redirect(await act('admin-grade',{userId:member.userId,version:String(member.version),role:'master',reason:'보조관리자'}),'error=confirm');redirect(await act('admin-grade',{userId:member.userId,version:String(member.version),role:'master',reason:'보조관리자',confirmMaster:'yes'}),'saved=1');
const panel=await getMemberAdmin(1,'테스트','');eq(panel.total,2);assert.ok(panel.audit.some(e=>e.action==='paid_approved'));checks++;
eq((await getMemberAdmin(1,'','master')).total,2);
db.close();console.log(`${checks} membership Node checks passed: Google provisional signup, profile validation, role gates, master protection, payment approval/audit, concurrent edits, Q&A access and answers.`);
