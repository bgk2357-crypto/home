// @ts-nocheck -- dual-runtime integration contract with an isolated database and mail transport double.
import assert from 'node:assert/strict';
import {openDatabase} from '../scripts/node-env.mjs';
import {GET,POST} from '../app/api/community/route';
import {GET as rights,POST as remove} from '../app/api/content/route';
import {POST as generic} from '../app/actions/[action]/route';
import {accountStatus,accountAction} from '../app/account-actions';
import {signValue} from '../app/auth/session';
import {communityScenarios} from './community-scenarios.mjs';
import {secret,identity,fixtures} from './community-fixtures.mjs';
import {maskContent,validFilter} from '../lib/moderation';
const db=openDatabase(':memory:'),origin='http://community.test',deliveries=[];
globalThis.safetyEnv={DB:db,AUTH_SECRET:secret,APP_ORIGIN:origin,MAIL_API_URL:'https://mail.example.test/send',MAIL_API_KEY:'test-only',MAIL_FROM:'no-reply@example.test'};
await db.exec(fixtures());const jar=new Map();let csrf='';
const cookies=()=>[...jar].map(([k,v])=>k+'='+v).join('; ');
function absorb(r){for(const h of r.headers.getSetCookie()){const [k,...v]=h.split(';')[0].split('=');jar.set(k,v.join('='));}}
const nativeFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{assert.equal(input,'https://mail.example.test/send');deliveries.push(JSON.parse(init.body));return Response.json({id:'test'});};
async function status(){const r=await accountStatus(new Request(origin+'/api/account',{headers:{cookie:cookies()}}));absorb(r);const d=await r.json();csrf=d.csrf;return d;}
async function actor(name){jar.clear();if(name)jar.set('argo_session',await signValue(identity(name)));await status();}
try{
 const checks=await communityScenarios({actor,status,mail:async()=>deliveries,sql:async sql=>{if(sql.startsWith('SELECT'))return(await db.prepare(sql).all()).results;await db.exec(sql);return[];},api:async(kind,query={},body,requestOrigin=origin)=>{const request=new Request(origin+'/api/'+kind+'?'+new URLSearchParams(query),{method:body?'POST':'GET',headers:{cookie:cookies(),origin:requestOrigin,'Content-Type':'application/json'},...(body?{body:JSON.stringify({csrf,...body})}:{})});const r=await(kind==='community'?(body?POST:GET):(body?remove:rights))(request);absorb(r);return r;},form:async(action,values)=>{const r=await accountAction(new Request(origin+'/auth/email/'+action,{method:'POST',headers:{cookie:cookies(),origin},body:new URLSearchParams({_csrf:csrf,...values})}),action);absorb(r);return r;},guestWrite:async()=>{const r=await generic(new Request(origin+'/actions/guestbook',{method:'POST',headers:{origin,cookie:cookies()},body:new URLSearchParams({author:'익명',body:'브라우저 소유'})}),{params:Promise.resolve({action:'guestbook'})});absorb(r);}});
 assert.equal(validFilter('regex','[씨시][\\s._-]{0,3}[발빨팔]'),true);assert.equal(maskContent('씨_발', [{id:1,kind:'regex',expression:'[씨시][\\s._-]{0,3}[발빨팔]'}]),'***');
 console.log(checks+' Node community/recovery/withdrawal/ownership checks passed.');
}finally{globalThis.fetch=nativeFetch;db.close();}
