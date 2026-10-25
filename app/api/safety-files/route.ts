import { env } from "cloudflare:workers";
import { decodedChunk, MAX_FILE_BYTES } from "../../../lib/safety-resources";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const id=new URL(request.url).searchParams.get("file")||"";
 const db=env.DB;if(!db)return new Response("자료실에 연결할 수 없습니다.",{status:503});
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))return new Response("파일을 찾을 수 없습니다.",{status:404});
 const file=await db.prepare("SELECT f.name,f.size,f.static_path AS staticPath FROM safety_files f JOIN safety_posts p ON p.id=f.post_id WHERE f.id=? AND p.published=1").bind(id).first<{name:string;size:number;staticPath:string|null}>();
 if(!file)return new Response("파일을 찾을 수 없습니다.",{status:404});
 if(file.staticPath){if(!["/safety/guide.pdf","/safety/seven-elements.png","/safety/seven-checklist.png"].includes(file.staticPath))return new Response("Not found",{status:404});return Response.redirect(new URL(file.staticPath,request.url),302);}
 if(file.size<1||file.size>MAX_FILE_BYTES)return new Response("파일을 읽을 수 없습니다.",{status:500});
 const chunks=(await db.prepare("SELECT part,data FROM safety_file_chunks WHERE file_id=? ORDER BY part").bind(id).all<{part:number;data:string}>()).results;
 const result=new Uint8Array(file.size);let offset=0;
 try{for(let i=0;i<chunks.length;i++){if(chunks[i].part!==i)throw Error();const bytes=decodedChunk(chunks[i].data);result.set(bytes,offset);offset+=bytes.length;}if(offset!==file.size)throw Error();}catch{return new Response("파일을 읽을 수 없습니다.",{status:500});}
 return new Response(result,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,"Content-Length":String(result.length),"X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}});
}
