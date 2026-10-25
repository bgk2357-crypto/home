import { canWrite } from "../lib/membership";
import { env } from "cloudflare:workers";
import { getUser } from "./auth";
import { getMember } from "./data";
import { setting } from "./runtime-config";
import { RESOURCE_PATH, MAX_FILES, MAX_REQUEST_BYTES, safeFilename, validCategory, validFileBytes, encodedChunks } from "../lib/safety-resources";
const go=(request:Request,path:string)=>Response.redirect(new URL(path,request.url),303);
export async function uploadResource(request:Request){
 const origin=request.headers.get("origin");
 if(!origin || (origin!==new URL(request.url).origin && origin!==setting("APP_ORIGIN")))return new Response("다른 사이트에서의 제출은 허용하지 않습니다.",{status:403});
 const user=await getUser(); if(!user)return new Response("로그인 후 이용해주세요.",{status:401});
 const member=await getMember(user.userId);if(!member||!canWrite(member))return new Response("홈페이지 회원가입 후 작성할 수 있습니다.",{status:403});
 const invalid=()=>go(request,RESOURCE_PATH+"?write=1&error=invalid#resource-write");
 const fileError=()=>go(request,RESOURCE_PATH+"?write=1&error=file#resource-write");
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))return invalid();
 if(Number(request.headers.get("content-length"))>MAX_REQUEST_BYTES)return fileError();
 let form:FormData;
 try{
  const reader=request.body?.getReader();if(!reader)return invalid();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_REQUEST_BYTES){await reader.cancel();return fileError();}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  form=await new Request(request.url,{method:"POST",headers:request.headers,body:bytes}).formData();
 }catch{return invalid();}
 const field=(name:string,max:number)=>{const all=form.getAll(name);if(all.length!==1||typeof all[0]!=="string")return null;const value=all[0].replace(/\r\n?/g,"\n").trim();return value.length>0&&value.length<=max&&!value.includes("\0")?value:null;};
 const title=field("title",100),body=field("body",20000),category=field("category",20);
 if(!title||!body||!category||!validCategory(category)||form.getAll("consent").length!==1||form.get("consent")!=="public")return invalid();
 const files=form.getAll("files").filter(value=>typeof value!=="string"&&value.name!=="");
 if(files.length>MAX_FILES||form.getAll("files").some(value=>typeof value==="string"))return fileError();
 const checked:{name:string;bytes:Uint8Array}[]=[];
 for(const file of files){if(typeof file==="string")return fileError();const name=safeFilename(file.name);if(file.size>5*1024*1024)return fileError();const bytes=new Uint8Array(await file.arrayBuffer());if(!name||!validFileBytes(name,bytes))return fileError();checked.push({name,bytes});}
 const db=env.DB;if(!db)return go(request,RESOURCE_PATH+"?write=1&error=busy");
 const id=crypto.randomUUID();
 try{
  const inserted=await db.prepare("INSERT INTO safety_posts(id,user_id,author,category,title,body,created_at,published) SELECT ?,?,?,?,?,?,?,0 WHERE (SELECT COUNT(*) FROM safety_posts)<10000 AND (SELECT COUNT(*) FROM safety_posts WHERE user_id=?)<1000").bind(id,user.userId,member.displayName,category,title,body,new Date().toISOString(),user.userId).run();
  if(!inserted.meta.changes)return go(request,RESOURCE_PATH+"?write=1&error=capacity");
  for(const file of checked){
   const fid=crypto.randomUUID();await db.prepare("INSERT INTO safety_files(id,post_id,name,size) VALUES(?,?,?,?)").bind(fid,id,file.name,file.bytes.length).run();
   const chunks=encodedChunks(file.bytes);
   for(let offset=0;offset<chunks.length;offset+=20)await db.batch(chunks.slice(offset,offset+20).map((data,index)=>db.prepare("INSERT INTO safety_file_chunks(file_id,part,data) VALUES(?,?,?)").bind(fid,offset+index,data)));
  }
  await db.prepare("UPDATE safety_posts SET published=1 WHERE id=?").bind(id).run();
  return go(request,`${RESOURCE_PATH}?post=${id}&saved=1`);
 }catch{
  // Only a fully saved post is public. Remove this failed upload, never existing posts.
  try{await db.prepare("DELETE FROM safety_posts WHERE id=? AND published=0").bind(id).run();}catch{}
  return go(request,RESOURCE_PATH+"?write=1&error=busy");
 }
}
