import {accountDb} from '../../credential-store';
import {sessionUser,cookieValue,cookie,SESSION_SECONDS} from '../../auth/session';
import {ensureMember} from '../../member-store';
import {tokenHash} from '../../account-recovery';
import {isMaster} from '../../../lib/membership';
import {setting} from '../../runtime-config';
import {smallJson} from '../../../lib/read-json';
export const dynamic='force-dynamic';
async function handle(request:Request,mutate=false){
 const db=accountDb(),url=new URL(request.url),header=request.headers.get('cookie')||'';
 let b:Record<string,any>=Object.fromEntries(url.searchParams);
 if(mutate){const origin=request.headers.get('origin');if(!origin||(origin!==url.origin&&origin!==setting('APP_ORIGIN')))return Response.json({error:'origin'},{status:403});const body=await smallJson(request);if(!body)return Response.json({error:'invalid'},{status:400});b=body;}
 let csrf=cookieValue(header,'argo_csrf');if(mutate&&(!csrf||!/^[a-f0-9]{64}$/.test(csrf)||csrf!==b.csrf))return Response.json({error:'csrf'},{status:403});
 if(!csrf||!/^[a-f0-9]{64}$/.test(csrf))csrf=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 const {kind,id}=b;if(!['guestbook','qna','community','resource'].includes(kind)||!['number','string'].includes(typeof id))return Response.json({error:'invalid'},{status:400});
 const table=kind==='guestbook'?'guestbook':kind==='resource'?'safety_posts':'posts',guard=['qna','community'].includes(kind)?' AND kind=?':'',args=guard?[id,kind]:[id];
 const row=await db.prepare('SELECT * FROM '+table+' WHERE id=?'+guard).bind(...args).first<Record<string,any>>();
 const user=await sessionUser(header),master=isMaster(user?await ensureMember(user):null),ownerToken=cookieValue(header,'argo_guest_owner');
 const own=row&&((user&&row.user_id===user.userId)||(kind==='guestbook'&&ownerToken&&row.owner_hash===await tokenHash(ownerToken))),allowed=!!row&&!!(master||own);
 if(mutate){if(!allowed)return Response.json({error:'permission'},{status:403});await db.prepare('DELETE FROM '+table+' WHERE id=?'+guard).bind(...args).run();return Response.json({ok:true});}
 return Response.json({canDelete:allowed,csrf},{headers:{'Cache-Control':'no-store','Set-Cookie':cookie('argo_csrf',csrf,SESSION_SECONDS,url.origin)}});
}
export function GET(request:Request){return handle(request);}
export function POST(request:Request){return handle(request,true);}
