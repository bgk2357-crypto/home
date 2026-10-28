// @ts-nocheck -- isolated real SQLite authentication fixtures.
import assert from 'node:assert/strict';
import {openDatabase} from '../scripts/node-env.mjs';
import {accountAction,accountStatus} from '../app/account-actions';
import {ensureMember} from '../app/member-store';
import {googleAccount,credentialsForUser} from '../app/credential-store';
import {sessionUser,signValue} from '../app/auth/session';
import {validPassword,normalizedEmail} from '../lib/account-policy';
import {hashPassword,verifyPassword} from '../lib/password';
import {checkEmailAccounts} from './email-scenarios.mjs';
globalThis.safetyEnv={DB:openDatabase(':memory:'),AUTH_SECRET:'email-tests-012345678901234567890123456',APP_ORIGIN:'http://account.test'};
const db=globalThis.safetyEnv.DB,jar=new Map(),origin='http://account.test';let csrf='';
function cookies(){return [...jar].map(([key,value])=>`${key}=${value}`).join('; ');}
function absorb(response){for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}}
async function identity(){return sessionUser(cookies());}
const checks=await checkEmailAccounts({origin,logout:async()=>{jar.clear();csrf='';},status:async()=>{const response=await accountStatus(new Request(origin+'/api/account',{headers:{cookie:cookies()}}));absorb(response);const data=await response.json();csrf=data.csrf;return data;},member:async()=>ensureMember(await identity()),post:async(action,form,options={})=>{const response=await accountAction(new Request(origin+'/auth/email/'+action,{method:'POST',headers:{origin:options.origin||origin,cookie:cookies()},body:new URLSearchParams({...form,_csrf:options.csrf||csrf})}),action);absorb(response);return response;}});
assert.equal(normalizedEmail(' User@Example.COM '),'user@example.com');
for(const password of ['short1!','LongPassword1234!!','NoSpecial12','12345678!','Letters!!!','Abc12!\n','한글Ab12!!'])assert.equal(validPassword(password),false,password);
for(const password of ['Abc123!@','Abc12345678901!?'])assert.equal(validPassword(password),true);
const legacy={userId:'google:legacy-paid',email:'legacy@example.test',displayName:'기존 정회원',fullName:null,authMethod:'google',authenticatedAt:Date.now()/1000};
await ensureMember(legacy);await db.prepare("UPDATE members SET role='paid',business_name='기존 사업장' WHERE user_id=?").bind(legacy.userId).run();
await credentialsForUser(legacy);const saved=await googleAccount(legacy);assert.equal(saved.userId,legacy.userId);assert.equal((await ensureMember(saved)).role,'paid');
jar.clear();jar.set('argo_session',await signValue({type:'session',...legacy,exp:Date.now()/1000+3600}));
let response=await accountStatus(new Request(origin+'/api/account',{headers:{cookie:cookies()}}));absorb(response);csrf=(await response.json()).csrf;
response=await accountAction(new Request(origin+'/auth/email/password',{method:'POST',headers:{origin,cookie:cookies()},body:new URLSearchParams({_csrf:csrf,password:'Legacy12!',confirmPassword:'Legacy12!'})}),'password');assert.equal(response.status,303);
assert.equal((await ensureMember(legacy)).role,'paid');assert.equal((await ensureMember(legacy)).businessName,'기존 사업장');
assert.equal(await verifyPassword('Legacy12!',(await credentialsForUser(legacy)).passwordHash),true);
await assert.rejects(()=>googleAccount({...legacy,userId:'google:unknown-same-email'}));
const local={userId:'local:claim-owner',email:'bgk2357@gmail.com',displayName:'신규 이메일',fullName:null,authMethod:'password'};assert.equal((await ensureMember(local)).role,'preliminary');
const localMember={userId:'local:link',email:'link@example.test',displayName:'연결 회원',fullName:null,authMethod:'password'};await ensureMember(localMember);await credentialsForUser(localMember);
const linked=await googleAccount({userId:'google:linked-id',email:localMember.email,displayName:'Google',fullName:null,authMethod:'google'},localMember.userId);assert.equal(linked.userId,localMember.userId);
assert.equal((await googleAccount({userId:'google:linked-id',email:localMember.email,displayName:'Google',fullName:null})).userId,localMember.userId);
await assert.rejects(()=>googleAccount({userId:'google:other',email:'wrong@example.test',displayName:'wrong',fullName:null},localMember.userId));
const stored=await hashPassword('Interop12!');assert.ok(stored.startsWith('pbkdf2_sha256$600000$'));assert.ok(!stored.includes('Interop12!'));
console.log(`${checks} Node email HTTP checks plus policy, legacy grades, secure first-password setup, Google linking, owner impersonation and hash checks passed.`);
const {DatabaseSync}=await import('node:sqlite'),{readdirSync,readFileSync}=await import('node:fs');
const before=new DatabaseSync(':memory:');before.exec('PRAGMA foreign_keys=ON');
for(const filename of readdirSync('drizzle').filter(name=>name.endsWith('.sql')&&name<'0006_email_accounts.sql').sort())before.exec(readFileSync('drizzle/'+filename,'utf8'));
before.prepare("INSERT INTO members(user_id,display_name,created_at,email,role,business_name) VALUES('google:migrated','기존회원','2026-10-01','Legacy.User@Example.test','paid','기존 사업장')").run();
before.exec(readFileSync('drizzle/0006_email_accounts.sql','utf8'));
assert.equal(before.prepare("SELECT role FROM members WHERE user_id='google:migrated'").get().role,'paid');
const migrated=before.prepare("SELECT * FROM auth_credentials WHERE email='legacy.user@example.test'").get();assert.equal(migrated.user_id,'google:migrated');assert.equal(migrated.password_hash,null);assert.equal(migrated.google_user_id,'google:migrated');before.close();
console.log('Migration preserves pre-existing IDs/grades/data and reserves normalized email with no default password.');
db.close();
