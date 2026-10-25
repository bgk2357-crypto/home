import { env } from "cloudflare:workers";
import { validCategory, type ResourcePost, type ResourceFile } from "../lib/safety-resources";
type Row = Omit<ResourcePost,"files">;
export async function getResources(page=1, search="", category="") {
 const db=env.DB; if(!db)throw Error("Database unavailable");
 const q=search.trim().slice(0,100); const args:string[]=[]; let where="published=1";
 if(q){where+=" AND (instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0)";args.push(q,q);}
 if(validCategory(category)){where+=" AND category=?";args.push(category);}
 const total=Number((await db.prepare(`SELECT COUNT(*) AS total FROM safety_posts WHERE ${where}`).bind(...args).first<{total:number}>())?.total||0);
 const pages=Math.max(1,Math.ceil(total/10)); const current=Math.max(1,Math.min(pages,Number.isInteger(page)?page:1));
 const result=await db.prepare(`SELECT id,author,category,title,body,created_at AS createdAt FROM safety_posts WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 10 OFFSET ?`).bind(...args,(current-1)*10).all<Row>();
 const items=await Promise.all(result.results.map(async row=>({...row,files:(await db.prepare("SELECT id,name,size FROM safety_files WHERE post_id=? ORDER BY id").bind(row.id).all<ResourceFile>()).results})));
 return {items,total,pages,current};
}
export async function getResource(id:string):Promise<ResourcePost|null>{
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))return null;
 const db=env.DB;if(!db)throw Error("Database unavailable");
 const row=await db.prepare("SELECT id,author,category,title,body,created_at AS createdAt FROM safety_posts WHERE id=? AND published=1").bind(id).first<Row>();
 return row?{...row,files:(await db.prepare("SELECT id,name,size FROM safety_files WHERE post_id=? ORDER BY id").bind(id).all<ResourceFile>()).results}:null;
}
