import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

globalThis.authTestEnv = {
  GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
  AUTH_SECRET: 'test-only-session-secret-32-characters-minimum', APP_ORIGIN: 'http://localhost:5173',
};
const directory = new URL('../.sites-runtime/tests/', import.meta.url);
await mkdir(directory, {recursive:true});
const plugin = { name: 'auth-env', setup(context) {
  context.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));
  context.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env=globalThis.authTestEnv;'}));
}};
for (const [name,entry] of [['start','app/auth/google/route.ts'],['callback','app/auth/google/callback/route.ts'],['session','app/auth/session.ts'],['logout','app/auth/logout/route.ts']]) {
  await build({entryPoints:[entry],outfile:fileURLToPath(new URL(`auth-${name}.mjs`,directory)),bundle:true,platform:'node',format:'esm',plugins:[plugin]});
}
const {GET:start}=await import(new URL('auth-start.mjs',directory));
const {GET:callback}=await import(new URL('auth-callback.mjs',directory));
const session=await import(new URL('auth-session.mjs',directory));
const {GET:logout}=await import(new URL('auth-logout.mjs',directory));
let checks=0; function equal(actual,expected){assert.equal(actual,expected);checks++;}
const origin=globalThis.authTestEnv.APP_ORIGIN;
const response=await start(new Request(origin+'/auth/google?return_to=%2Fcommunity%3Fwrite%3D1'));
const google=new URL(response.headers.get('location'));
equal(google.origin,'https://accounts.google.com'); equal(google.searchParams.get('scope'),'openid email profile');
equal(google.searchParams.get('code_challenge_method'),'S256');
equal(google.searchParams.get('redirect_uri'),origin+'/auth/google/callback');
const flowCookie=response.headers.get('set-cookie').split(';')[0];
const flow=await session.readValue(flowCookie.split('=')[1]);
equal(await session.codeChallenge(flow.verifier),google.searchParams.get('code_challenge'));
const originalFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async (url,options)=>{
  calls++;
  if(url==='https://oauth2.googleapis.com/token') {
    equal(options.body.get('code_verifier'),flow.verifier);
    return Response.json({access_token:'test-google-token'});
  }
  equal(options.headers.Authorization,'Bearer test-google-token');
  return Response.json({sub:'1234',email:'user@example.test',email_verified:true,name:'테스트 사용자'});
};
const callbackUrl=origin+'/auth/google/callback?code=code&state='+google.searchParams.get('state');
const success=await callback(new Request(callbackUrl,{headers:{cookie:flowCookie}}));
equal(success.headers.get('location'),origin+'/community?write=1');equal(calls,2);
const signedCookie=success.headers.getSetCookie().find(value=>value.startsWith('argo_session='));
const user=await session.sessionUser(signedCookie.split(';')[0]);
equal(user.userId,'google:1234');equal(user.email,'user@example.test');
const failure=await callback(new Request(callbackUrl.replace('state=','state=bad'),{headers:{cookie:flowCookie}}));
equal(new URL(failure.headers.get('location')).searchParams.get('error'),'cancelled');equal(calls,2);
equal((await callback(new Request(callbackUrl))).status,303);equal(calls,2);
const external=await start(new Request('http://192.168.0.37:5173/auth/google'));
equal(new URL(external.headers.get('location')).searchParams.get('error'),'origin');
const signout=await logout(new Request(origin+'/auth/logout?return_to=https://evil.test'));
equal(signout.headers.get('location'),origin+'/');equal(signout.headers.getSetCookie().every(value=>value.includes('Max-Age=0')),true);
globalThis.authTestEnv.GOOGLE_CLIENT_ID='';
equal(new URL((await start(new Request(origin+'/auth/google'))).headers.get('location')).searchParams.get('error'),'configuration');
globalThis.fetch=originalFetch;
console.log(`${checks} Google OAuth checks passed (mock Google responses): PKCE, state, signed session, logout and origin checks.`);
