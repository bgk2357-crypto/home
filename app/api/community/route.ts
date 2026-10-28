import {sessionUser,cookieValue,cookie,SESSION_SECONDS} from '../../auth/session';
import {ensureMember} from '../../member-store';
import {communityData,communityDb} from '../../community-store';
import {canWrite,isMaster} from '../../../lib/membership';
import {validFilter} from '../../../lib/moderation';
import {setting} from '../../runtime-config';
import {smallJson} from '../../../lib/read-json';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await sessionUser(request.headers.get('cookie')||''),member=user?await ensureMember(user):null,url=new URL(request.url);
 let csrf=cookieValue(request.headers.get('cookie')||'','argo_csrf');if(!csrf||!/^[a-f0-9]{64}$/.test(csrf))csrf=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
 const number=(key:string)=>{const value=Number(url.searchParams.get(key)||1);return Number.isSafeInteger(value)&&value>0?Math.min(value,10000):1;};
 const post=Number(url.searchParams.get('post')),postId=Number.isSafeInteger(post)&&post>0?post:0;
 return Response.json({...await communityData(user?.userId,isMaster(member),number('page'),postId,number('commentPage')),csrf,canWrite:canWrite(member),authenticated:!!user,isMaster:isMaster(member)},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie('argo_csrf',csrf,SESSION_SECONDS,url.origin)}});
}
export async function POST(request:Request){
 const url=new URL(request.url),origin=request.headers.get('origin');if(!origin||(origin!==url.origin&&origin!==setting('APP_ORIGIN')))return Response.json({error:'origin'},{status:403});
 const user=await sessionUser(request.headers.get('cookie')||'');if(!user)return Response.json({error:'authentication'},{status:401});
 const member=await ensureMember(user),body=await smallJson(request);if(!body)return Response.json({error:'invalid'},{status:400});
 const csrf=cookieValue(request.headers.get('cookie')||'','argo_csrf');if(!csrf||!/^[a-f0-9]{64}$/.test(csrf)||body.csrf!==csrf)return Response.json({error:'csrf'},{status:403});
 const db=communityDb(),now=new Date().toISOString(),action=body.action;
 const fail=(status=400)=>Response.json({error:'invalid-or-stale'},{status});
 if(action==='rule-add'||action==='rule-delete'){
  if(!isMaster(member))return fail(403);
  if(action==='rule-add'){
   if(typeof body.expression!=='string'||!validFilter(body.kind,body.expression))return fail();
   const total=await db.prepare('SELECT count(*) AS n FROM content_filters').first<{n:number}>();if((total?.n||0)>=200)return fail();
   try{await db.batch([db.prepare('INSERT INTO content_filters(kind,expression,created_at,created_by) VALUES(?,?,?,?)').bind(body.kind,body.expression,now,user.userId),db.prepare("INSERT INTO moderation_audit(actor_id,action,expression,created_at) VALUES(?,'add',?,?)").bind(user.userId,body.expression,now)]);}catch{return fail();}
  }else{
   if(!Number.isSafeInteger(body.id))return fail();const row=await db.prepare('SELECT expression FROM content_filters WHERE id=?').bind(body.id).first<{expression:string}>();if(!row)return fail(404);
   await db.batch([db.prepare('DELETE FROM content_filters WHERE id=?').bind(body.id),db.prepare("INSERT INTO moderation_audit(actor_id,action,expression,created_at) VALUES(?,'delete',?,?)").bind(user.userId,row.expression,now)]);
  }
  return Response.json({ok:true});
 }
 const id=body.id,postId=body.postId;
 if(action==='create'||action==='comment-create'){
  if(!canWrite(member))return fail(403);
  if(typeof body.body!=='string'||!body.body.trim()||body.body.length>(action==='create'?2000:1000))return fail();
  if(action==='create'){
   if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100)return fail();
   const result=await db.prepare("INSERT INTO posts(kind,user_id,author,title,body,created_at) SELECT 'community',?,?,?,?,? WHERE (SELECT count(*) FROM posts WHERE kind='community')<10000").bind(user.userId,member!.displayName,body.title.trim(),body.body.trim(),now).run();return result.meta.changes?Response.json({ok:true,id:result.meta.last_row_id}):fail();
  }
  if(!Number.isSafeInteger(postId))return fail();
  const result=await db.prepare("INSERT INTO community_comments(post_id,user_id,author,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND kind='community') AND (SELECT count(*) FROM community_comments WHERE post_id=?)<1000").bind(postId,user.userId,member!.displayName,body.body.trim(),now,postId,postId).run();return result.meta.changes?Response.json({ok:true}):fail();
 }
 if(!['update','delete','comment-update','comment-delete'].includes(action)||!Number.isSafeInteger(id)||!Number.isSafeInteger(body.version))return fail();
 const comments=action.startsWith('comment-'),table=comments?'community_comments':'posts',guard=comments?'':" AND kind='community'";
 let result;
 if(action.endsWith('delete'))result=await db.prepare(`DELETE FROM ${table} WHERE id=? AND version=?${isMaster(member)?'':' AND user_id=?'}${guard}`).bind(...(isMaster(member)?[id,body.version]:[id,body.version,user.userId])).run();
 else{
  if(typeof body.body!=='string'||!body.body.trim()||body.body.length>(comments?1000:2000))return fail();
  if(!comments&&(typeof body.title!=='string'||!body.title.trim()||body.title.length>100))return fail();
  result=comments?await db.prepare('UPDATE community_comments SET body=?,updated_at=?,version=version+1 WHERE id=? AND user_id=? AND version=?').bind(body.body.trim(),now,id,user.userId,body.version).run():await db.prepare("UPDATE posts SET title=?,body=?,updated_at=?,version=version+1 WHERE id=? AND user_id=? AND version=? AND kind='community'").bind(body.title.trim(),body.body.trim(),now,id,user.userId,body.version).run();
 }
 return result.meta.changes?Response.json({ok:true}):fail(409);
}
