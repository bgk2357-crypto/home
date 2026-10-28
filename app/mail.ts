import {setting} from './runtime-config';
export function mailReady(){return /^https:\/\//.test(setting('MAIL_API_URL'))&&!!setting('MAIL_API_KEY')&&!!setting('MAIL_FROM')&&/^https?:\/\//.test(setting('APP_ORIGIN'));}
export async function sendResetMail(to:string,token:string){
 const link=new URL('/login',setting('APP_ORIGIN'));link.searchParams.set('mode','reset');link.searchParams.set('token',token);
 const response=await fetch(setting('MAIL_API_URL'),{method:'POST',headers:{Authorization:`Bearer ${setting('MAIL_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({from:setting('MAIL_FROM'),to:[to],subject:'HOME 비밀번호 재설정',text:`가입 이메일의 비밀번호를 재설정하려면 15분 안에 아래 링크를 여세요. 링크는 한 번만 사용할 수 있습니다. 요청하지 않았다면 무시하세요.\n${link}`}),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error('Mail delivery failed');
}
