import {env} from 'cloudflare:workers';
import {maskContent,type FilterRule} from '../lib/moderation';
export function communityDb(){if(!env.DB)throw Error('Database unavailable');return env.DB;}
export async function filterRules(){return(await communityDb().prepare('SELECT id,kind,expression FROM content_filters ORDER BY id').all<FilterRule>()).results;}
export function publicContent(row:Record<string,any>,userId:string|undefined,rules:FilterRule[],detail=false,master=false){
 const own=row.user_id===userId;return {id:row.id,author:maskContent(row.author,rules),title:row.title===undefined?undefined:maskContent(row.title,rules),body:maskContent(row.body,rules),createdAt:row.created_at,updatedAt:row.updated_at,version:row.version,isOwn:own,canDelete:own||master,commentCount:row.comment_count||0,...(own&&detail?{editable:{title:row.title,body:row.body}}:{})};
}
export async function communityData(userId:string|undefined,master:boolean,page=1,postId=0,commentPage=1){
 const db=communityDb(),rules=await filterRules(),total=Number((await db.prepare("SELECT count(*) AS n FROM posts WHERE kind='community'").first<{n:number}>())?.n||0),pages=Math.max(1,Math.ceil(total/10)),current=Math.max(1,Math.min(page,pages));
 const rows=(await db.prepare("SELECT p.*,(SELECT count(*) FROM community_comments c WHERE c.post_id=p.id) AS comment_count FROM posts p WHERE kind='community' ORDER BY p.id DESC LIMIT 10 OFFSET ?").bind((current-1)*10).all()).results;
 const selected=postId?await db.prepare("SELECT * FROM posts WHERE id=? AND kind='community'").bind(postId).first<Record<string,any>>():null;
 const commentTotal=selected?Number((await db.prepare('SELECT count(*) AS n FROM community_comments WHERE post_id=?').bind(postId).first<{n:number}>())?.n||0):0,commentPages=Math.max(1,Math.ceil(commentTotal/10)),commentCurrent=Math.max(1,Math.min(commentPage,commentPages));
 const comments=selected?(await db.prepare('SELECT * FROM community_comments WHERE post_id=? ORDER BY id LIMIT 10 OFFSET ?').bind(postId,(commentCurrent-1)*10).all()).results:[];
 return {items:rows.map(row=>publicContent(row,userId,rules,false,master)),total,pages,current,selected:selected?publicContent(selected,userId,rules,true,master):null,comments:comments.map(row=>publicContent(row,userId,rules,true,master)),commentTotal,commentPages,commentCurrent,...(master?{rules}:{})};
}
