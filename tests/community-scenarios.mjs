import assert from 'node:assert/strict';
export async function communityScenarios({api,actor,form,sql,mail,status,guestWrite}){
 let checks=0;function equal(actual,expected,message){assert.deepEqual(actual,expected,message);checks++;}
 await actor('a');let data=await(await api('community')).json();equal(data.items.length,10,'page size');equal(data.pages,2,'pagination');equal(data.canWrite,true);equal(data.isMaster,false);
 equal((await(await api('community',{page:2})).json()).items.length,2);
 const created=await api('community',{}, {action:'create',title:'씨발 제목',body:'씨_발 내용'});equal(created.status,200);const id=(await created.json()).id;
 data=await(await api('community',{post:id})).json();equal(data.selected.title,'** 제목');equal(data.selected.body,'*** 내용');equal(data.selected.editable.body,'씨_발 내용');equal(data.selected.isOwn,true);
 equal((await api('community',{}, {action:'comment-create',postId:id,body:'개 새 끼 댓글'})).status,200);
 data=await(await api('community',{post:id})).json();const comment=data.comments[0];equal(comment.body,'***** 댓글');
 equal((await api('community',{}, {action:'update',id,version:1,title:'수정 제목',body:'수정 내용'})).status,200);
 equal((await api('community',{}, {action:'update',id,version:1,title:'경합',body:'거절'})).status,409,'stale update');
 equal((await api('community',{}, {action:'comment-update',id:comment.id,version:1,body:'댓글 수정'})).status,200);
 await actor('b');data=await(await api('community',{post:id})).json();equal(data.selected.isOwn,false);equal(data.selected.editable,undefined);equal(data.selected.canDelete,false);
 equal((await api('community',{}, {action:'delete',id,version:2})).status,409,'foreign deletion');equal((await api('community',{}, {action:'comment-delete',id:comment.id,version:2})).status,409);
 equal((await api('community',{}, {action:'rule-add',kind:'keyword',expression:'금지테스트'})).status,403);
 await actor('master');data=await(await api('community',{post:id})).json();equal(data.selected.canDelete,true);equal(data.selected.editable,undefined);equal(data.rules.length>=12,true);
 equal((await api('community',{}, {action:'rule-add',kind:'regex',expression:'(a+)+$'})).status,400,'dangerous pattern');
 equal((await api('community',{}, {action:'rule-add',kind:'keyword',expression:'금지테스트'})).status,200);
 data=await(await api('community')).json();const rule=data.rules.find(r=>r.expression==='금지테스트');equal(!!rule,true);
 equal((await api('community',{}, {action:'rule-delete',id:rule.id})).status,200);
 equal((await api('community',{}, {action:'comment-delete',id:comment.id,version:2})).status,200);
 equal((await api('community',{}, {action:'comment-create',postId:id,body:'연결 삭제 확인'})).status,200);
 equal((await api('community',{}, {action:'delete',id,version:2})).status,200);
 equal((await sql('SELECT * FROM community_comments WHERE post_id='+id)).length,0,'post deletion cascades comments');
 for(const kind of ['guestbook','qna','resource']){
  const target=kind==='resource'?'resource-a':kind==='qna'?100:100;
  await actor('b');equal((await(await api('content',{kind,id:target})).json()).canDelete,false);equal((await api('content',{}, {kind,id:target})).status,403);
  await actor('a');equal((await(await api('content',{kind,id:target})).json()).canDelete,true);
  await actor('master');equal((await(await api('content',{kind,id:target})).json()).canDelete,true);equal((await api('content',{}, {kind,id:target})).status,200);
 }
 equal((await sql("SELECT * FROM safety_files WHERE id='file-a'")).length,0,'attachments cascade');equal((await sql("SELECT * FROM safety_file_chunks WHERE file_id='file-a'")).length,0);
 await actor(null);await guestWrite();data=await(await api('content',{kind:'guestbook',id:101})).json();equal(data.canDelete,true,'anonymous browser ownership');equal((await api('content',{}, {kind:'guestbook',id:101})).status,200);
 await actor('a');equal((await api('community',{}, {action:'create',title:'x',body:'x',csrf:'invalid'})).status,403);
 equal((await api('community',{}, {action:'create',title:'x',body:'x'},'https://evil.test')).status,403);
 await actor(null);equal((await api('community',{}, {action:'create',title:'x',body:'x'})).status,401);
 // Transport is a test double; all reset routing, tokens, recipients and database operations are real.
 await status();let response=await form('forgot',{email:'a@example.test'});equal(response.headers.get('location').includes('saved=sent'),true);let deliveries=await mail();equal(deliveries.at(-1).to[0],'a@example.test');let token=deliveries.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
 const row=await sql('SELECT token_hash,expires_at FROM auth_password_resets');equal(row[0].token_hash===token,false);equal(row[0].expires_at> Date.now()/1000,true);
 response=await form('forgot',{email:'unknown@example.test'});equal(response.headers.get('location').includes('saved=sent'),true);equal((await mail()).length,deliveries.length);
 response=await form('reset',{token,password:'weak',confirmPassword:'weak'});equal(response.headers.get('location').includes('error=password'),true);
 await actor('a');const old=await status();equal(old.authenticated,true);
 await actor(null);response=await form('reset',{token,password:'Newpass12!',confirmPassword:'Newpass12!'});equal(response.headers.get('location').includes('saved=reset'),true);equal((await status()).authenticated,false,'no automatic reset login');
 response=await form('reset',{token,password:'Nextpass12!',confirmPassword:'Nextpass12!'});equal(response.headers.get('location').includes('error=token'),true,'single use');
 await actor('a');equal((await status()).authenticated,false,'old password session revoked');await actor(null);
 response=await form('login',{email:'a@example.test',password:'Newpass12!',return_to:'/members'});equal((await status()).authenticated,true,'login independent Google');
 await actor(null);await form('forgot',{email:'a@example.test'});deliveries=await mail();token=deliveries.at(-1).text.match(/token=([a-f0-9]{64})/)[1];await sql('UPDATE auth_password_resets SET expires_at=1');
 response=await form('reset',{token,password:'Expired12!',confirmPassword:'Expired12!'});equal(response.headers.get('location').includes('error=token'),true,'expired token');
 await sql("UPDATE auth_credentials SET google_user_id='google:linked-b' WHERE user_id='local:b';INSERT INTO posts(kind,user_id,author,title,body,created_at) VALUES('qna','local:b','B','문의','비공개 문의','2026-10-28');INSERT INTO safety_posts(id,user_id,author,category,title,body,created_at,published) VALUES('resource-b','local:b','B','기타','자료','본문','2026-10-28',1);");
 await actor('b');await status();response=await form('withdraw',{confirmWithdrawal:'탈퇴',currentPassword:'wrong'});equal(response.headers.get('location').includes('error=reauth'),true);
 response=await form('withdraw',{confirmWithdrawal:'탈퇴',currentPassword:'Password12!'});equal(response.headers.get('location').includes('saved=withdrawn'),true);equal((await status()).authenticated,false);
 await actor('b');equal((await status()).authenticated,false,'withdrawn session cannot revive account');equal((await sql("SELECT email FROM members WHERE user_id='local:b'"))[0].email,'');equal((await sql("SELECT * FROM auth_credentials WHERE user_id='local:b'")).length,0);
 equal((await sql("SELECT * FROM posts WHERE user_id='local:b'")).length,0);equal((await sql("SELECT * FROM safety_posts WHERE user_id='local:b'")).length,0);equal((await sql("SELECT * FROM auth_retired_identities WHERE user_id='google:linked-b'")).length,1);
 await actor('master');await status();response=await form('withdraw',{confirmWithdrawal:'탈퇴'});equal(response.headers.get('location').includes('error=lastmaster'),true);
 return checks;
}
