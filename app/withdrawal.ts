import type {User} from './auth/session';
import {accountDb,credentialsForUser,recentGoogle} from './credential-store';
import {verifyPassword} from '../lib/password';
export async function withdraw(user:User,form:URLSearchParams){
 if(form.get('confirmWithdrawal')!=='탈퇴')return 'confirm';
 const account=await credentialsForUser(user);if(!recentGoogle(user)&&!await verifyPassword(form.get('currentPassword')||'',account?.passwordHash||null))return 'reauth';
 const db=accountDb();const member=await db.prepare('SELECT role FROM members WHERE user_id=?').bind(user.userId).first<{role:string}>();
 if(member?.role==='master'&&Number((await db.prepare("SELECT count(*) AS n FROM members WHERE role='master' AND deleted_at IS NULL").first<{n:number}>())?.n)<2)return 'lastmaster';
 // Keep an empty tombstone so previously signed Google sessions cannot recreate a withdrawn member.
 const tables=['auth_password_resets','auth_credentials','member_paid_requests','msds_publication_events','msds_assets','msds_workspace_settings','community_comments','posts','safety_posts','guestbook'];
 await db.batch([db.prepare('INSERT OR IGNORE INTO auth_retired_identities(user_id) SELECT google_user_id FROM auth_credentials WHERE user_id=? AND google_user_id IS NOT NULL').bind(user.userId),...tables.map(table=>db.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user.userId)),db.prepare("UPDATE members SET deleted_at=?,email='',display_name='탈퇴회원',role='preliminary',business_name='',business_size='',contact_name='',job_title='',phone='',profile_completed_at=NULL,version=version+1 WHERE user_id=?").bind(new Date().toISOString(),user.userId)]);
 return null;
}
