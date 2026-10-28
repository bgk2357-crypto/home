<?php
function reset_ready(){ $c=config();return !empty($c['mail_from'])&&filter_var($c['mail_from'],FILTER_VALIDATE_EMAIL)&&!empty($c['app_origin'])&&(($c['mail_transport']??'')==='mail'||(($c['mail_transport']??'')==='api'&&strpos($c['mail_api_url']??'','https://')===0&&!empty($c['mail_api_key']))); }
function reset_send($email,$token){
 $c=config();$link=rtrim($c['app_origin'],'/').route_url('/login?mode=reset&token='.$token);$subject='HOME 비밀번호 재설정';$text="가입 이메일의 비밀번호를 재설정하려면 15분 안에 아래 링크를 여세요. 한 번만 사용할 수 있습니다. 요청하지 않았다면 무시하세요.\n".$link;
 if(($c['mail_transport']??'')==='mail'){if(!mail($email,'=?UTF-8?B?'.base64_encode($subject).'?=',$text,"From: ".$c['mail_from']."\r\nContent-Type: text/plain; charset=UTF-8"))throw new RuntimeException('Mail unavailable');return;}
 $curl=curl_init($c['mail_api_url']);curl_setopt_array($curl,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode(['from'=>$c['mail_from'],'to'=>[$email],'subject'=>$subject,'text'=>$text],JSON_UNESCAPED_UNICODE),CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Bearer '.$c['mail_api_key']],CURLOPT_TIMEOUT=>15,CURLOPT_CONNECTTIMEOUT=>7,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_RETURNTRANSFER=>true]);$ok=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_HTTP_CODE);curl_close($curl);if($ok===false||$status<200||$status>=300)throw new RuntimeException('Mail unavailable');
}
function account_recovery($action,$form){
 $db=db();if($action==='forgot'){
  if(!reset_ready())redirect_to('/login?mode=forgot&error=mail');$email=account_email($form['email']??null);if(!$email)redirect_to('/login?mode=forgot&error=email');
  if(account_rate('forgot:'.$email,3)){
   $account=account_by_email($email);if($account){$token=bin2hex(random_bytes(32));$hash=hash('sha256',$token);
    $db->beginTransaction();try{$db->prepare('DELETE FROM auth_password_resets WHERE user_id=? OR expires_at<?')->execute([$account['user_id'],time()]);$db->prepare('INSERT INTO auth_password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')->execute([$hash,$account['user_id'],time()+900,time()]);$db->commit();}catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    try{reset_send($account['email'],$token);}catch(Throwable $e){$db->prepare('DELETE FROM auth_password_resets WHERE token_hash=?')->execute([$hash]);error_log('[argo] Reset mail delivery failed');}
   }
  }redirect_to('/login?mode=forgot&saved=sent');
 }
 $token=$form['token']??'';$password=$form['password']??'';if(!preg_match('/^[a-f0-9]{64}$/D',$token))redirect_to('/login?mode=forgot&error=token');
 if(!account_password_valid($password)||$password!==($form['confirmPassword']??null))redirect_to('/login?mode=reset&token='.$token.'&error=password');
 $hash=hash('sha256',$token);$passwordHash=account_hash($password);$db->beginTransaction();
 try{$q=$db->prepare('SELECT user_id FROM auth_password_resets WHERE token_hash=? AND consumed_by IS NULL AND expires_at>?');$q->execute([$hash,time()]);$row=$q->fetch();if(!$row){$db->rollBack();redirect_to('/login?mode=forgot&error=token');}
 $db->prepare('UPDATE auth_password_resets SET consumed_by=? WHERE token_hash=?')->execute([bin2hex(random_bytes(16)),$hash]);$db->prepare('UPDATE auth_credentials SET password_hash=?,session_version=session_version+1,updated_at=? WHERE user_id=?')->execute([$passwordHash,now_iso(),$row['user_id']]);$db->commit();}catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
 set_cookie('argo_session','',-1);redirect_to('/login?saved=reset');
}
function account_withdraw($identity,$form){
 if(($form['confirmWithdrawal']??'')!=='탈퇴')redirect_to('/members?error=confirm');$account=account_for_user($identity);
 if(!account_recent_google($identity)&&!account_verify($form['currentPassword']??'',$account['password_hash']??null))redirect_to('/members?error=reauth');
 $db=db();$db->exec('BEGIN IMMEDIATE');try{
 $q=$db->prepare('SELECT role FROM members WHERE user_id=?');$q->execute([$identity['userId']]);$member=$q->fetch();if(($member['role']??'')==='master'&&(int)$db->query("SELECT count(*) FROM members WHERE role='master' AND deleted_at IS NULL")->fetchColumn()<2){$db->exec('ROLLBACK');redirect_to('/members?error=lastmaster');}
 $db->prepare('INSERT OR IGNORE INTO auth_retired_identities(user_id) SELECT google_user_id FROM auth_credentials WHERE user_id=? AND google_user_id IS NOT NULL')->execute([$identity['userId']]);
 foreach(['auth_password_resets','auth_credentials','member_paid_requests','msds_publication_events','msds_assets','msds_workspace_settings','community_comments','posts','safety_posts','guestbook'] as $table)$db->prepare('DELETE FROM '.$table.' WHERE user_id=?')->execute([$identity['userId']]);
 $db->prepare("UPDATE members SET deleted_at=?,email='',display_name='탈퇴회원',role='preliminary',business_name='',business_size='',contact_name='',job_title='',phone='',profile_completed_at=NULL,version=version+1 WHERE user_id=?")->execute([now_iso(),$identity['userId']]);$db->exec('COMMIT');
 }catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}set_cookie('argo_session','',-1);redirect_to('/login?saved=withdrawn');
}
