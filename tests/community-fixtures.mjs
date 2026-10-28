import {pbkdf2Sync} from 'node:crypto';
export const secret='community-tests-secret-012345678901234567890';
export function identity(name){return name?{type:'session',userId:name==='master'?'google:master':'local:'+name,email:name+'@example.test',displayName:name,authMethod:name==='master'?'google':'password',authenticatedAt:Date.now()/1000,exp:Date.now()/1000+3600}:null;}
export function fixtures(){
 const salt='0123456789abcdef0123456789abcdef',hash='pbkdf2_sha256$600000$'+salt+'$'+pbkdf2Sync('Password12!',Buffer.from(salt,'hex'),600000,32,'sha256').toString('hex');
 let sql='';for(const name of ['a','b','master']){const u=identity(name);sql+=`INSERT INTO members(user_id,display_name,created_at,email,role,business_name,business_size,contact_name,job_title,phone) VALUES('${u.userId}','${name}','2026-10-28','${u.email}','${name==='master'?'master':'general'}','사업장','5인 미만','담당자','팀장','01012345678');INSERT INTO auth_credentials(email,user_id,password_hash,updated_at) VALUES('${u.email}','${u.userId}','${hash}','2026-10-28');`;}
 for(let i=1;i<=12;i++)sql+=`INSERT INTO posts(id,kind,user_id,author,title,body,created_at) VALUES(${i},'community','local:a','회원','글 ${i}','내용','2026-10-28');`;
 sql+="INSERT INTO posts(id,kind,user_id,author,title,body,created_at) VALUES(100,'qna','local:a','회원','문의','비공개 문의','2026-10-28');INSERT INTO guestbook(id,user_id,author,body,created_at) VALUES(100,'local:a','회원','방명록','2026-10-28');INSERT INTO safety_posts(id,user_id,author,category,title,body,created_at,published) VALUES('resource-a','local:a','회원','기타','자료','자료내용','2026-10-28',1);";
 sql+="INSERT INTO safety_files(id,post_id,name,size) VALUES('file-a','resource-a','테스트.txt',1);INSERT INTO safety_file_chunks(file_id,part,data) VALUES('file-a',0,'YQ==');";
 return sql;
}
