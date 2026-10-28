import {cleanHierarchy,processAssignment} from '../../../lib/process-hierarchy';
import { env } from 'cloudflare:workers';
import { randomUUID,randomBytes } from 'node:crypto';
import { getUser } from '../../auth';
import { getMember } from '../../data';
import { cleanAsset, emptySettings, workspaceAccess,publicationChange } from '../../../lib/workspace';
import { validFileBytes,safeFilename } from '../../../lib/safety-resources';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
type Row={id:string;payload:string;version:number;file_name:string;file_size:number;updated_at:string;last_op:string;user_id:string};
async function identity(){const user=await getUser();return user&&workspaceAccess(await getMember(user.userId))?user:null;}
export async function GET(request:Request){
 const user=await identity();if(!user)return reply({error:'paid-member-required'},403);const db=env.DB;if(!db)return reply({error:"database-unavailable"},503);
 const file=new URL(request.url).searchParams.get('file');
 if(file){
  const row=await db.prepare('SELECT * FROM msds_assets WHERE id=? AND user_id=?').bind(file,user.userId).first<Row>();if(!row||!row.file_size)return reply({error:'not-found'},404);
  const chunks=(await db.prepare('SELECT part,data FROM msds_original_chunks WHERE asset_id=? ORDER BY part').bind(file).all<{part:number;data:string}>()).results;
  const bytes=Buffer.concat(chunks.map((c,i)=>{if(c.part!==i)throw Error('Invalid file');return Buffer.from(c.data,'base64');}));if(bytes.length!==row.file_size||bytes.length>5*1024*1024)return reply({error:'file-unavailable'},500);
  const pdf=row.file_name.toLowerCase().endsWith('.pdf');return new Response(bytes,{headers:{'Content-Type':pdf?'application/pdf':'application/octet-stream','Content-Disposition':`${pdf?'inline':'attachment'}; filename="original"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 const rows=(await db.prepare('SELECT * FROM msds_assets WHERE user_id=? ORDER BY updated_at DESC,id LIMIT 100').bind(user.userId).all<Row>()).results;
 const settings=await db.prepare('SELECT payload,version FROM msds_workspace_settings WHERE user_id=?').bind(user.userId).first<{payload:string;version:number}>();
 const hierarchy=cleanHierarchy(settings?JSON.parse(settings.payload).hierarchy:[])||[];
 const history=(await db.prepare('SELECT id,payload,created_at FROM msds_publication_events WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200').bind(user.userId).all<{id:string;payload:string;created_at:string}>()).results.map(r=>({...JSON.parse(r.payload),id:r.id,createdAt:r.created_at}));
 const previous=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('argo_csrf='))?.slice(10);const csrf=previous&&/^[a-f0-9]{64}$/.test(previous)?previous:randomBytes(32).toString('hex');
 return Response.json({items:rows.map(r=>({...JSON.parse(r.payload),...(JSON.parse(r.payload).categoryId?processAssignment(hierarchy,JSON.parse(r.payload).categoryId):{}),version:r.version,fileSize:r.file_size,updatedAt:r.updated_at})),settings:settings?{...emptySettings,...JSON.parse(settings.payload),version:settings.version}:emptySettings,csrf,history},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Set-Cookie':`argo_csrf=${csrf}; Path=/; HttpOnly; SameSite=Lax${new URL(request.url).protocol==='https:'?'; Secure':''}`}});
}
export async function POST(request:Request){
 const user=await identity();if(!user)return reply({error:'paid-member-required'},403);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)return reply({error:'different-origin'},403);
 const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('argo_csrf='))?.slice(10);
 if(!cookie||!/^[a-f0-9]{64}$/.test(cookie)||request.headers.get('x-csrf-token')!==cookie)return reply({error:'refresh-form'},403);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'invalid'},400);
 let text='';const reader=request.body?.getReader();if(!reader)return reply({error:'invalid'},400);let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>9*1024*1024){await reader.cancel();return reply({error:'too-large'},413);}chunks.push(value);}text=Buffer.concat(chunks).toString('utf8');
 let body;try{body=JSON.parse(text);}catch{return reply({error:'invalid'},400);}const {action,version}=body;if(!Number.isSafeInteger(version)||version<0)return reply({error:'invalid'},400);
 const db=env.DB,uid=user.userId;if(!db)return reply({error:"database-unavailable"},503);
 if(action==='delete-history'){if(typeof body.id!=='string')return reply({error:'invalid'},400);const r=await db.prepare('DELETE FROM msds_publication_events WHERE id=? AND user_id=?').bind(body.id,uid).run();return reply({ok:true},r.meta.changes?200:404);}
 if(action==='settings'){
  const s=body.settings;if(!s||typeof s.businessName!=='string'||s.businessName.length>120||typeof s.notice!=='string'||s.notice.length>3000||!Array.isArray(s.categories)||s.categories.length>50||s.categories.some((c:unknown)=>typeof c!=='string'||!c.trim()||c.length>120))return reply({error:'invalid'},400);
  const extra:Record<string,string>={};for(const key of ['department','processName','postingLocation']){const v=s[key]??'';if(typeof v!=='string'||v.length>120)return reply({error:'invalid'},400);extra[key]=v;}
  const hierarchy=cleanHierarchy(s.hierarchy);if(!hierarchy)return reply({error:'invalid-hierarchy'},400);
  const references=(await db.prepare('SELECT payload FROM msds_assets WHERE user_id=?').bind(uid).all<{payload:string}>()).results;if(references.some(r=>{const id=JSON.parse(r.payload).categoryId;return id&&!hierarchy.some(n=>n.id===id);}))return reply({error:'classification-in-use'},409);
  const payload=JSON.stringify({hierarchy,businessName:s.businessName,notice:s.notice,categories:[...new Set(s.categories)],...extra});
  const q=version===0?db.prepare('INSERT OR IGNORE INTO msds_workspace_settings(user_id,payload) VALUES(?,?)').bind(uid,payload):db.prepare('UPDATE msds_workspace_settings SET payload=?,version=version+1 WHERE user_id=? AND version=?').bind(payload,uid,version);
  const result=await q.run();return result.meta.changes?reply({ok:true,version:version+1}):reply({error:'stale'},409);
 }
 const item=action==='save'?cleanAsset(body.item):null,id=action==='save'?item?.id:body.id;
 if(!['save','delete'].includes(action)||typeof id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(id)||(action==='save'&&!item))return reply({error:'invalid'},400);
 const old=await db.prepare('SELECT * FROM msds_assets WHERE id=?').bind(id).first<Row>();if(old&&old.user_id!==uid)return reply({error:'not-found'},404);
 if((old?.version||0)!==version||(!old&&action==='delete'))return reply({error:'stale'},409);
 if(action==='delete'){const event=publicationChange(JSON.parse(old!.payload),null);const statements=[];if(event)statements.push(db.prepare('INSERT INTO msds_publication_events(id,user_id,asset_id,payload,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM msds_assets WHERE id=? AND user_id=? AND version=?)').bind(randomUUID(),uid,id,JSON.stringify(event),new Date().toISOString(),id,uid,version));statements.push(db.prepare('DELETE FROM msds_assets WHERE id=? AND user_id=? AND version=?').bind(id,uid,version));await db.batch(statements);const remaining=await db.prepare('SELECT id FROM msds_assets WHERE id=? AND user_id=?').bind(id,uid).first();return remaining?reply({error:'stale'},409):reply({ok:true});}
 if(item?.categoryId){const settingsRow=await db.prepare('SELECT payload FROM msds_workspace_settings WHERE user_id=?').bind(uid).first<{payload:string}>();const nodes=cleanHierarchy(settingsRow?JSON.parse(settingsRow.payload).hierarchy:[])||[];if(!nodes.some(n=>n.id===item.categoryId))return reply({error:'invalid-classification'},400);Object.assign(item,processAssignment(nodes,String(item.categoryId)));}
 let bytes:Buffer|null=null;let name=old?.file_name||'';
 if(body.file){if(typeof body.file.name!=='string'||typeof body.file.data!=='string'||/[^A-Za-z0-9+/=]/.test(body.file.data))return reply({error:'invalid-file'},400);bytes=Buffer.from(body.file.data,'base64');name=safeFilename(body.file.name);if(!name||bytes.length<1||bytes.length>5*1024*1024||!validFileBytes(name,new Uint8Array(bytes)))return reply({error:'invalid-file'},400);}
 const op=randomUUID(),now=new Date().toISOString(),fileSize=bytes?.length??old?.file_size??0;
 const first=old?db.prepare('UPDATE msds_assets SET payload=?,version=version+1,file_name=?,file_size=?,updated_at=?,last_op=? WHERE id=? AND user_id=? AND version=?').bind(JSON.stringify(item),name,fileSize,now,op,id,uid,version):db.prepare('INSERT OR IGNORE INTO msds_assets(id,user_id,payload,file_name,file_size,updated_at,last_op) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM msds_assets WHERE user_id=?)<100').bind(id,uid,JSON.stringify(item),name,fileSize,now,op,uid);
 const statements=[first];if(bytes){statements.push(db.prepare('DELETE FROM msds_original_chunks WHERE asset_id=? AND EXISTS(SELECT 1 FROM msds_assets WHERE id=? AND last_op=?)').bind(id,id,op));for(let offset=0,part=0;offset<bytes.length;offset+=32768,part++)statements.push(db.prepare('INSERT INTO msds_original_chunks(asset_id,part,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM msds_assets WHERE id=? AND last_op=?)').bind(id,part,bytes.subarray(offset,offset+32768).toString('base64'),id,op));}
 const event=publicationChange(old?JSON.parse(old.payload):null,item);if(event)statements.push(db.prepare('INSERT INTO msds_publication_events(id,user_id,asset_id,payload,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM msds_assets WHERE id=? AND last_op=?)').bind(randomUUID(),uid,id,JSON.stringify(event),now,id,op));
 await db.batch(statements);const result=await db.prepare('SELECT last_op FROM msds_assets WHERE id=? AND user_id=?').bind(id,uid).first<{last_op:string}>();
 return result?.last_op===op?reply({ok:true,version:version+1,fileSize,updatedAt:now}):reply({error:'stale-or-capacity'},409);
}
