import { env } from "cloudflare:workers";
import { getUser } from "./auth";
import { getMember } from "./data";
import { memberColumns,ownerEmail } from "./member-store";
import { setting } from "./runtime-config";
import { canWrite,isMaster,profileComplete,validateProfile,MEMBER_ROLES,type MemberProfile } from "../lib/membership";
const go=(r:Request,path:string)=>Response.redirect(new URL(path,r.url),303);
async function smallForm(request:Request){
 if(request.headers.get("content-type")?.split(";")[0]!=="application/x-www-form-urlencoded")return null;
 const reader=request.body?.getReader();if(!reader)return null;let size=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return null;}parts.push(value);}
 const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}try{return new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return null;}
}
function text(form:URLSearchParams,key:string,max:number){const all=form.getAll(key);return all.length===1&&all[0].trim().length<=max&&!all[0].includes("\0")?all[0].trim():null;}
export async function memberAction(request:Request,action:string){
 const origin=request.headers.get("origin");if(!origin||(origin!==new URL(request.url).origin&&origin!==setting("APP_ORIGIN")))return new Response("허용되지 않은 요청입니다.",{status:403});
 const user=await getUser();if(!user)return new Response("로그인 후 이용해주세요.",{status:401});
 const member=await getMember(user.userId);const admin=action.startsWith("admin-")||action==="qna-answer";
 if(admin&&!isMaster(member))return new Response("관리자만 이용할 수 있습니다.",{status:403});
 const path=admin?"/admin/members":"/members";const bad=(reason="invalid")=>go(request,path+"?error="+reason);
 let form:URLSearchParams|null;try{form=await smallForm(request);}catch{return bad();}if(!form)return bad();
 const db=env.DB;if(!db||!member)return bad("busy");const now=new Date().toISOString();
 try{
  if(action==="member-profile"||action==="join"){
   const p=validateProfile(form);if(!p)return bad();
   await db.prepare("UPDATE members SET display_name=?,business_name=?,business_size=?,contact_name=?,job_title=?,phone=?,profile_completed_at=COALESCE(profile_completed_at,?),updated_at=?,role=CASE WHEN role IN ('paid','master') THEN role ELSE 'general' END,version=version+1 WHERE user_id=?").bind(p.displayName,p.businessName,p.businessSize,p.contactName,p.jobTitle,p.phone,now,now,user.userId).run();
   return go(request,"/members?saved=profile");
  }
  if(action==="paid-request"){
   if(!canWrite(member)||member.role!=="general")return new Response("기본정보를 모두 입력한 일반회원만 신청할 수 있습니다.",{status:403});
   const note=text(form,"note",500);if(!note||form.get("consent")!=="yes")return bad();
   await db.prepare("INSERT INTO member_paid_requests(id,user_id,note,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM member_paid_requests WHERE user_id=? AND status='pending')").bind(crypto.randomUUID(),user.userId,note,now,user.userId).run();
   return go(request,"/members?saved=request");
  }
  if(action==="paid-cancel"){
   const id=text(form,"requestId",80);if(!id)return bad();await db.prepare("UPDATE member_paid_requests SET status='cancelled',reviewed_at=? WHERE id=? AND user_id=? AND status='pending'").bind(now,id,user.userId).run();return go(request,"/members?saved=cancelled");
  }
  if(action==="qna-answer"){
   const id=Number(text(form,"postId",20)),answer=text(form,"answer",10000);if(!Number.isSafeInteger(id)||id<1||!answer)return bad();
   const result=await db.prepare("UPDATE posts SET answer=?,answered_at=?,answered_by=? WHERE id=? AND kind='qna'").bind(answer,now,user.userId,id).run();return go(request,result.meta.changes?"/qna?saved=1":"/qna?error=invalid");
  }
  if(action==="admin-grade"||action==="admin-paid-review"){
   let id=text(form,"userId",300),requestId=text(form,"requestId",80),target:MemberProfile|null=null;
   const versionValue=text(form,"version",20),version=Number(versionValue),reason=text(form,"reason",500);
   if(!id||!versionValue||!Number.isSafeInteger(version)||version<0||!reason)return bad();
   target=await db.prepare(`SELECT ${memberColumns} FROM members WHERE user_id=?`).bind(id).first<MemberProfile>();if(!target)return bad();
   if(target.email?.toLowerCase()===ownerEmail())return bad("owner");
   let next=text(form,"role",20)||"";const decision=text(form,"decision",20);
   if(action==="admin-paid-review"){if(!requestId||!["approve","reject"].includes(decision||""))return bad();next=decision==="approve"?"paid":target.role||"preliminary";}
   if(!(MEMBER_ROLES as readonly string[]).includes(next))return bad();
   if(["general","paid"].includes(next)&&!profileComplete(target))return bad("profile");
   if(next==="master"&&form.get("confirmMaster")!=="yes")return bad("confirm");
   if(target.role==="master"&&next!=="master"&&(await db.prepare("SELECT count(*) AS n FROM members WHERE role='master'").first<{n:number}>())!.n<2)return bad("owner");
   const approving=next==="paid"&&(action==="admin-grade"||decision==="approve");
   const amount=Number(text(form,"amount",15)),reference=text(form,"paymentReference",200);
   if(approving&&(form.get("paymentConfirmed")!=="yes"||!Number.isSafeInteger(amount)||amount<1||amount>1000000000||!reference))return bad("payment");
   const operation=crypto.randomUUID();let condition="user_id=? AND version=?";const args:(string|number)[]=[id,version];
   if(action==="admin-paid-review"){condition+=" AND EXISTS(SELECT 1 FROM member_paid_requests WHERE id=? AND user_id=members.user_id AND status='pending')";args.push(requestId!);}
   const auditAction=action==="admin-grade"?"grade_change":decision==="approve"?"paid_approved":"paid_rejected";
   const note=approving?`${reason} | 결제확인 ${amount}원 | ${reference}`:reason;
   const jobs=[db.prepare(`INSERT INTO member_audit(operation_id,actor_id,target_id,action,old_role,new_role,reason,created_at) SELECT ?,?,user_id,?,role,?,?,? FROM members WHERE ${condition}`).bind(operation,user.userId,auditAction,next,note,now,...args),db.prepare("UPDATE members SET role=?,updated_at=?,version=version+1 WHERE user_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE operation_id=?)").bind(next,now,id,operation)];
   if(action==="admin-paid-review")jobs.push(db.prepare("UPDATE member_paid_requests SET status=?,reviewed_at=?,reviewed_by=?,review_note=?,amount=?,payment_reference=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM member_audit WHERE operation_id=?)").bind(decision==="approve"?"approved":"rejected",now,user.userId,reason,approving?amount:0,approving?reference:"",requestId!,operation));
   await db.batch(jobs);
   const done=await db.prepare("SELECT id FROM member_audit WHERE operation_id=?").bind(operation).first();return done?go(request,path+"?saved=1"):bad("stale");
  }
  return new Response("Not found",{status:404});
 }catch{return bad("busy");}
}
