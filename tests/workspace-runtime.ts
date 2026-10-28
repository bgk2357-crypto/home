// @ts-nocheck -- isolated SQLite integration fixtures.
import {openDatabase} from '../scripts/node-env.mjs';
import {GET,POST} from '../app/api/workspace/route';
import {signValue} from '../app/auth/session';
import {checkWorkspace} from './workspace-scenarios.mjs';
globalThis.safetyEnv={DB:openDatabase(':memory:'),AUTH_SECRET:'test-workspace-secret-01234567890123456789'};globalThis.safetyHeaders=new Headers();
let token='',csrf='';
const checks=await checkWorkspace({async login(id){csrf='';token=id?await signValue({type:'session',userId:'google:'+id,email:id==='general'?'general@example.test':'bgk2357@gmail.com',displayName:'검토용 '+id,exp:Date.now()/1000+3600}):'';},async call(body,options={}){const cookies=token?'argo_session='+token+'; argo_csrf='+csrf:'';globalThis.safetyHeaders=new Headers({Cookie:cookies});const request=new Request('https://site.test/api/workspace'+(options.file?'?file='+options.file:''),{method:body?'POST':'GET',headers:{Cookie:cookies,...(body?{Origin:options.origin||'https://site.test','Content-Type':'application/json','X-CSRF-Token':options.csrf||csrf}:{})},body:body?JSON.stringify(body):undefined});const r=await(body?POST(request):GET(request));if(!body&&r.ok&&!options.file)csrf=(await r.clone().json()).csrf;return r;}});
console.log(`${checks} Node workspace checks passed: member isolation, originals, CSRF, versions, review, settings, deletion.`);
globalThis.safetyEnv.DB.close();
