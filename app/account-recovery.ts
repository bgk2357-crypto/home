import {accountDb,credentialsByEmail,authRate} from './credential-store';
import {mailReady,sendResetMail} from './mail';
import {hashPassword} from '../lib/password';
import {validPassword,normalizedEmail} from '../lib/account-policy';
export async function tokenHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function recovery(action:string,form:URLSearchParams){
 const db=accountDb(),email=normalizedEmail(form.get('email'));
 if(action==='forgot'){
  if(!mailReady())return '/login?mode=forgot&error=mail';
  if(!email)return '/login?mode=forgot&error=email';
  if(!await authRate('forgot:'+email,3))return '/login?mode=forgot&saved=sent';
  const account=await credentialsByEmail(email);
  if(account){const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''),hash=await tokenHash(token);
   await db.batch([db.prepare('DELETE FROM auth_password_resets WHERE user_id=? OR expires_at<?').bind(account.userId,Math.floor(Date.now()/1000)),db.prepare('INSERT INTO auth_password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(hash,account.userId,Math.floor(Date.now()/1000)+900,new Date().toISOString())]);
   try{await sendResetMail(account.email,token);}catch{await db.prepare('DELETE FROM auth_password_resets WHERE token_hash=?').bind(hash).run();console.error('Reset mail delivery failed');}
  }
  return '/login?mode=forgot&saved=sent';
 }
 const token=form.get('token')||'',password=form.get('password')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return '/login?mode=forgot&error=token';
 if(!validPassword(password)||password!==form.get('confirmPassword'))return '/login?mode=reset&token='+encodeURIComponent(token)+'&error=password';
 const hash=await tokenHash(token),claim=crypto.randomUUID(),now=Math.floor(Date.now()/1000);
 if(!await db.prepare('SELECT user_id FROM auth_password_resets WHERE token_hash=? AND consumed_by IS NULL AND expires_at>?').bind(hash,now).first())return '/login?mode=forgot&error=token';
 const passwordHash=await hashPassword(password);
 await db.batch([db.prepare('UPDATE auth_password_resets SET consumed_by=? WHERE token_hash=? AND consumed_by IS NULL AND expires_at>?').bind(claim,hash,now),db.prepare('UPDATE auth_credentials SET password_hash=?,session_version=session_version+1,updated_at=? WHERE user_id=(SELECT user_id FROM auth_password_resets WHERE token_hash=? AND consumed_by=?)').bind(passwordHash,new Date().toISOString(),hash,claim)]);
 const row=await db.prepare('SELECT consumed_by FROM auth_password_resets WHERE token_hash=?').bind(hash).first<{consumed_by:string}>();
 return row?.consumed_by===claim?'/login?saved=reset':'/login?mode=forgot&error=token';
}
