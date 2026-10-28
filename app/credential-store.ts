import {env} from 'cloudflare:workers';
import {ensureMember,memberColumns} from './member-store';
import type {User} from './auth/session';
import {normalizedEmail} from '../lib/account-policy';
export function accountDb(){if(!env.DB)throw Error('Database unavailable');return env.DB;}
export type Credential={email:string;userId:string;passwordHash:string|null;googleUserId:string|null;sessionVersion:number};
const columns='email,user_id AS userId,password_hash AS passwordHash,google_user_id AS googleUserId,session_version AS sessionVersion';
export async function credentialsByEmail(email:string){return accountDb().prepare(`SELECT ${columns} FROM auth_credentials WHERE email=?`).bind(email).first<Credential>();}
export async function credentialsForUser(user:User){
 const existing=await accountDb().prepare(`SELECT ${columns} FROM auth_credentials WHERE user_id=?`).bind(user.userId).first<Credential>();if(existing)return existing;
 const email=normalizedEmail(user.email);if(!email)return null;
 await accountDb().prepare('INSERT OR IGNORE INTO auth_credentials(email,user_id,google_user_id,updated_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM members WHERE lower(trim(email))=?)=1').bind(email,user.userId,user.userId.startsWith('google:')?user.userId:null,new Date().toISOString(),email).run();
 return accountDb().prepare(`SELECT ${columns} FROM auth_credentials WHERE user_id=?`).bind(user.userId).first<Credential>();
}
export function recentGoogle(user:User){return user.authMethod==='google'&&typeof user.authenticatedAt==='number'&&user.authenticatedAt>Date.now()/1000-600&&user.authenticatedAt<=Date.now()/1000+30;}
export async function googleAccount(identity:User,linkUserId?:string){
 if(await accountDb().prepare('SELECT user_id FROM auth_retired_identities WHERE user_id=?').bind(identity.userId).first())throw Error('withdrawn');
 if(await accountDb().prepare('SELECT user_id FROM members WHERE user_id=? AND deleted_at IS NOT NULL').bind(identity.userId).first())throw Error('withdrawn');
 const db=accountDb(),email=normalizedEmail(identity.email);if(!email)throw Error('email');
 const mapped=await db.prepare(`SELECT ${columns} FROM auth_credentials WHERE google_user_id=?`).bind(identity.userId).first<Credential>();
 if(linkUserId){
  const current=await db.prepare(`SELECT ${columns} FROM auth_credentials WHERE user_id=?`).bind(linkUserId).first<Credential>();
  if(!current||current.email!==email||(mapped&&mapped.userId!==linkUserId))throw Error('link');
  await db.prepare('UPDATE auth_credentials SET google_user_id=?,updated_at=? WHERE user_id=?').bind(identity.userId,new Date().toISOString(),linkUserId).run();
  return {...identity,userId:linkUserId,email:current.email};
 }
 if(mapped)return {...identity,userId:mapped.userId,email:mapped.email};
 const original=await db.prepare(`SELECT ${memberColumns} FROM members WHERE user_id=?`).bind(identity.userId).first();
 // Existing Google users keep their original member and all permissions.
 if(original){await ensureMember(identity);await credentialsForUser(identity);return identity;}
 if(await credentialsByEmail(email)||await db.prepare('SELECT user_id FROM members WHERE lower(trim(email))=?').bind(email).first())throw Error('email-in-use');
 const now=new Date().toISOString();
 await db.batch([
  db.prepare("INSERT INTO members(user_id,display_name,created_at,email,role,updated_at) SELECT ?,?,?,?,'preliminary',? WHERE NOT EXISTS(SELECT 1 FROM members WHERE lower(trim(email))=?)").bind(identity.userId,identity.displayName.slice(0,30)||'회원',now,email,now,email),
  db.prepare('INSERT INTO auth_credentials(email,user_id,google_user_id,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE user_id=?)').bind(email,identity.userId,identity.userId,now,identity.userId),
 ]);
 const created=await credentialsForUser(identity);if(!created)throw Error('email-in-use');await ensureMember(identity);return identity;
}
export async function authRate(key:string,limit=8,seconds=900){
 const now=Math.floor(Date.now()/1000);
 await accountDb().batch([
  accountDb().prepare('INSERT OR IGNORE INTO auth_rate_limits(key,count,expires_at) VALUES(?,0,?)').bind(key,now+seconds),
  accountDb().prepare('UPDATE auth_rate_limits SET count=0,expires_at=? WHERE key=? AND expires_at<=?').bind(now+seconds,key,now),
 ]);
 const result=await accountDb().prepare('UPDATE auth_rate_limits SET count=count+1 WHERE key=? AND count<?').bind(key,limit).run();return !!result.meta.changes;
}
