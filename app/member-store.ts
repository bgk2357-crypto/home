import { env } from "cloudflare:workers";
import { setting } from "./runtime-config";
import type { User } from "./auth/session";
import type { MemberProfile,MemberAdminData,PaidRequest,MemberAudit } from "../lib/membership";
export const memberColumns="user_id AS userId,display_name AS displayName,created_at AS createdAt,email,role,business_name AS businessName,business_size AS businessSize,contact_name AS contactName,job_title AS jobTitle,phone,profile_completed_at AS profileCompletedAt,updated_at AS updatedAt,version";
export function ownerEmail(){return (setting("MASTER_EMAIL")||"bgk2357@gmail.com").trim().toLowerCase();}
export async function ensureMember(identity:User){
 const db=env.DB;if(!db)throw Error("Database unavailable");const now=new Date().toISOString();const email=identity.email.toLowerCase();
 await db.prepare("INSERT INTO members(user_id,display_name,created_at,email,role,updated_at) VALUES(?,?,?,?,'preliminary',?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email").bind(identity.userId,identity.displayName.slice(0,30)||"회원",now,email,now).run();
 if(email===ownerEmail()&&identity.userId.startsWith('google:')&&identity.authMethod!=='password'){
  const result=await db.prepare("UPDATE members SET role='master',version=version+1,updated_at=? WHERE user_id=? AND role!='master'").bind(now,identity.userId).run();
  if(result.meta.changes)await db.prepare("INSERT INTO member_audit(operation_id,actor_id,target_id,action,old_role,new_role,reason,created_at) VALUES(?,?,?,'bootstrap_master','','master','소유자가 지정한 Google 인증 계정',?)").bind(crypto.randomUUID(),identity.userId,identity.userId,now).run();
 }
 return db.prepare(`SELECT ${memberColumns} FROM members WHERE user_id=?`).bind(identity.userId).first<MemberProfile>();
}
export async function getMemberRequests(userId:string){const db=env.DB;if(!db)throw Error("Database unavailable");return (await db.prepare("SELECT id,user_id AS userId,status,note,created_at AS createdAt,reviewed_at AS reviewedAt,review_note AS reviewNote,amount,payment_reference AS paymentReference FROM member_paid_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(userId).all<PaidRequest>()).results;}
export async function getMemberAdmin(page=1,q="",role=""):Promise<MemberAdminData>{
 const db=env.DB;if(!db)throw Error("Database unavailable");const args:string[]=[];let where="1=1";
 if(q.trim()){where+=" AND (instr(lower(email),lower(?))>0 OR instr(lower(display_name),lower(?))>0 OR instr(lower(business_name),lower(?))>0)";const s=q.trim().slice(0,100);args.push(s,s,s);}
 if(["preliminary","general","paid","master"].includes(role)){where+=" AND role=?";args.push(role);}
 const total=Number((await db.prepare(`SELECT count(*) AS n FROM members WHERE ${where}`).bind(...args).first<{n:number}>())?.n||0);const pages=Math.max(1,Math.ceil(total/20)),current=Math.max(1,Math.min(pages,page));
 const members=(await db.prepare(`SELECT ${memberColumns} FROM members WHERE ${where} ORDER BY created_at DESC,user_id LIMIT 20 OFFSET ?`).bind(...args,(current-1)*20).all<MemberProfile>()).results;
 const requests=(await db.prepare("SELECT r.id,r.user_id AS userId,r.status,r.note,r.created_at AS createdAt,r.reviewed_at AS reviewedAt,r.review_note AS reviewNote,r.amount,r.payment_reference AS paymentReference,m.display_name AS author,m.email,m.business_name AS businessName,m.version FROM member_paid_requests r JOIN members m ON m.user_id=r.user_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 100").all<PaidRequest>()).results;
 const audit=(await db.prepare("SELECT id,actor_id AS actorId,target_id AS targetId,action,old_role AS oldRole,new_role AS newRole,reason,created_at AS createdAt FROM member_audit ORDER BY id DESC LIMIT 50").all<MemberAudit>()).results;
 return {members,total,pages,current,requests,audit};
}
