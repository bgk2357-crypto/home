import assert from 'node:assert/strict';
export async function checkEmailAccounts(client){
 let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 const path=response=>{const url=new URL(response.headers.get('location'),client.origin);return (url.searchParams.get('route')||url.pathname)+url.search;};
 const body={email:'New.Member@Example.test',password:'Abc123!@',confirmPassword:'Abc123!@',displayName:'이메일회원',consent:'yes',return_to:'/members'};
 await client.logout();await client.status();
 eq((await client.post('register',body,{csrf:'bad'})).status,403);
 eq((await client.post('register',body,{origin:'https://other.test'})).status,403);
 assert.ok(path(await client.post('register',{...body,email:'not-an-email'})).includes('error=email'));checks++;
 assert.ok(path(await client.post('register',{...body,email:'weak@example.test',password:'Abc12345',confirmPassword:'Abc12345'})).includes('error=password'));checks++;
 let result=await client.post('register',body);eq(result.status,303);
 let state=await client.status();eq(state.authenticated,true);eq(state.email,'new.member@example.test');eq(state.passwordConfigured,true);
 let member=await client.member();eq(member.role,'preliminary');const originalId=member.userId;
 await client.logout();await client.status();
 assert.ok(path(await client.post('register',{...body,email:'  NEW.MEMBER@example.test  '})).includes('error=duplicate'));checks++;
 assert.ok(path(await client.post('login',{...body,password:'Wrong123!'})).includes('error=credentials'));checks++;
 eq((await client.post('login',body)).status,303);eq((await client.member()).userId,originalId);
 assert.ok(path(await client.post('password',{password:'Changed12!',confirmPassword:'Changed12!',currentPassword:'Wrong123!'})).includes('error=reauth'));checks++;
 eq((await client.post('password',{password:'Changed12!',confirmPassword:'Changed12!',currentPassword:body.password})).status,303);
 await client.logout();await client.status();assert.ok(path(await client.post('login',body)).includes('error=credentials'));checks++;
 eq((await client.post('login',{...body,password:'Changed12!'})).status,303);eq((await client.member()).userId,originalId);
 await client.logout();await client.status();
 for(let i=0;i<8;i++)await client.post('login',{email:'rate@example.test',password:'Wrong123!'});
 assert.ok(path(await client.post('login',{email:'rate@example.test',password:'Wrong123!'})).includes('error=rate'));checks++;
 return checks;
}
