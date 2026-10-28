import {env} from 'cloudflare:workers';
import {cookie,cookieValue,SESSION_COOKIE,SESSION_SECONDS,sessionUser,signValue,safeReturnPath} from './auth/session';
import {ensureMember} from './member-store';
import {accountDb,authRate,credentialsByEmail,credentialsForUser,recentGoogle} from './credential-store';
import {normalizedEmail,validPassword} from '../lib/account-policy';
import {hashPassword,verifyPassword} from '../lib/password';
import {setting} from './runtime-config';
import {recovery} from './account-recovery';
import {mailReady} from './mail';
import {withdraw} from './withdrawal';
export async function accountStatus(request:Request){
 const user=await sessionUser(request.headers.get('cookie')||'');if(user)await ensureMember(user);
 const account=user?await credentialsForUser(user):null;
 let csrf=cookieValue(request.headers.get('cookie')||'','argo_csrf');if(!csrf||!/^[a-f0-9]{64}$/.test(csrf))csrf=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
 return Response.json({csrf,authenticated:!!user,email:user?.email||'',passwordConfigured:!!account?.passwordHash,googleLinked:!!account?.googleUserId,recentGoogle:!!user&&recentGoogle(user),resetReady:mailReady()},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie('argo_csrf',csrf,SESSION_SECONDS,new URL(request.url).origin)}});
}
export async function accountAction(request:Request,action:string){
 const url=new URL(request.url),headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
 const go=(path:string)=>{headers.set('Location',new URL(path,url).toString());return new Response(null,{status:303,headers});};
 const failure=(error:string)=>go(`/login?mode=${action==='register'?'signup':action==='password'?'manage':'login'}&error=${error}`);
 if(!['login','register','password','forgot','reset','withdraw'].includes(action))return new Response('Not found',{status:404});
 const origin=request.headers.get('origin');if(!origin||(origin!==url.origin&&origin!==setting('APP_ORIGIN')))return new Response('Forbidden',{status:403});
 if(request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded')return failure('invalid');
 const reader=request.body?.getReader();if(!reader)return failure('invalid');const chunks=[];let length=0;
 while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>8192){await reader.cancel();return failure('invalid');}chunks.push(next.value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const form=new URLSearchParams(new TextDecoder().decode(bytes));for(const key of new Set(form.keys()))if(form.getAll(key).length!==1)return failure('invalid');
 const csrf=cookieValue(request.headers.get('cookie')||'','argo_csrf');if(!csrf||!/^[a-f0-9]{64}$/.test(csrf)||form.get('_csrf')!==csrf)return new Response('Refresh form',{status:403});
 const password=form.get('password')||'',email=normalizedEmail(form.get('email'));
 try{
  if(action==='forgot'||action==='reset')return go(await recovery(action,form));
  if(action==='withdraw'){
   const current=await sessionUser(request.headers.get('cookie')||'');if(!current)return failure('authentication');
   const result=await withdraw(current,form);if(result)return go('/members?error='+result);
   headers.append('Set-Cookie',cookie(SESSION_COOKIE,'',0,url.origin));return go('/login?saved=withdrawn');
  }
  const rateKey=action==='password'?'password:'+cookieValue(request.headers.get('cookie')||'',SESSION_COOKIE)?.slice(-24):`${action}:${email||'invalid'}`;
  if(!await authRate(rateKey))return failure('rate');
  if(action==='register'){
   if(!email)return failure('email');if(!validPassword(password)||form.get('confirmPassword')!==password)return failure('password');if(form.get('consent')!=='yes')return failure('consent');
   if(await credentialsByEmail(email)||await accountDb().prepare('SELECT user_id FROM members WHERE lower(trim(email))=?').bind(email).first())return failure('duplicate');
   const id='local:'+crypto.randomUUID(),now=new Date().toISOString(),displayName=(form.get('displayName')?.trim()||email.split('@')[0]).slice(0,30),hash=await hashPassword(password);
   // Email primary key and the transaction prevent racing registrations.
   try{await accountDb().batch([accountDb().prepare("INSERT INTO members(user_id,display_name,created_at,email,role,updated_at) VALUES(?,?,?,?,'preliminary',?)").bind(id,displayName,now,email,now),accountDb().prepare('INSERT INTO auth_credentials(email,user_id,password_hash,updated_at) VALUES(?,?,?,?)').bind(email,id,hash,now)]);}catch{return failure('duplicate');}
   const token=await signValue({type:'session',userId:id,email,displayName,authMethod:'password',authenticatedAt:Date.now()/1000,exp:Date.now()/1000+SESSION_SECONDS});headers.append('Set-Cookie',cookie(SESSION_COOKIE,token,SESSION_SECONDS,url.origin));return go('/members?saved=registered');
  }
  if(action==='login'){
   if(!email||password.length>128)return failure('credentials');
   const account=await credentialsByEmail(email),valid=await verifyPassword(password,account?.passwordHash||null);
   if(!valid){if(!account?.passwordHash&&await accountDb().prepare('SELECT user_id FROM members WHERE lower(trim(email))=?').bind(email).first())return failure('setup');return failure('credentials');}
   const member=await accountDb().prepare('SELECT display_name FROM members WHERE user_id=?').bind(account!.userId).first<{display_name:string}>();if(!member)return failure('credentials');
   await accountDb().prepare('DELETE FROM auth_rate_limits WHERE key=?').bind(rateKey).run();
   headers.append('Set-Cookie',cookie(SESSION_COOKIE,await signValue({type:'session',userId:account!.userId,email:account!.email,displayName:member.display_name,authMethod:'password',sessionVersion:account!.sessionVersion,authenticatedAt:Date.now()/1000,exp:Date.now()/1000+SESSION_SECONDS}),SESSION_SECONDS,url.origin));return go(safeReturnPath(form.get('return_to'))||'/members');
  }
  const user=await sessionUser(request.headers.get('cookie')||'');if(!user)return failure('authentication');
  await ensureMember(user);const account=await credentialsForUser(user);if(!account)return failure('duplicate');
  if(!validPassword(password)||form.get('confirmPassword')!==password)return failure('password');
  if(!recentGoogle(user)&&!await verifyPassword(form.get('currentPassword')||'',account.passwordHash))return failure('reauth');
  await accountDb().prepare('UPDATE auth_credentials SET password_hash=?,updated_at=? WHERE user_id=?').bind(await hashPassword(password),new Date().toISOString(),user.userId).run();
  return go('/login?mode=manage&saved=password');
 }catch{return failure('busy');}
}
