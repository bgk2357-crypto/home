<?php
require_once __DIR__."/recovery.php";
function account_email($value){
 if(!is_string($value))return null;$email=strtolower(trim($value));$parts=explode('@',$email);
 if(strlen($email)>254||count($parts)!==2||strlen($parts[0])>64||substr($parts[0],0,1)==='.'||substr($parts[0],-1)==='.'||strpos($parts[0],'..')!==false)return null;
 return preg_match('/^[a-z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/iD',$email)?$email:null;
}
function account_password_valid($password){return is_string($password)&&preg_match('/^(?=.*[A-Za-z])(?=.*[0-9])(?=.*[^A-Za-z0-9])[\x21-\x7E]{8,16}$/D',$password);}
function account_hash($password){$salt=bin2hex(random_bytes(16));return 'pbkdf2_sha256$600000$'.$salt.'$'.hash_pbkdf2('sha256',$password,hex2bin($salt),600000,64);}
function account_verify($password,$stored){
 $parts=explode('$',$stored??'');$valid=count($parts)===4&&$parts[0]==='pbkdf2_sha256'&&$parts[1]==='600000'&&preg_match('/^[a-f0-9]{32}$/D',$parts[2])&&preg_match('/^[a-f0-9]{64}$/D',$parts[3]);
 $actual=hash_pbkdf2('sha256',$password,hex2bin($valid?$parts[2]:str_repeat('0',32)),600000,64);return hash_equals($valid?$parts[3]:str_repeat('0',64),$actual)&&$valid;
}
function account_by_email($email){$q=db()->prepare('SELECT * FROM auth_credentials WHERE email=?');$q->execute([$email]);return $q->fetch()?:null;}
function account_for_user($identity){
 $q=db()->prepare('SELECT * FROM auth_credentials WHERE user_id=?');$q->execute([$identity['userId']]);$row=$q->fetch();if($row)return $row;
 $email=account_email($identity['email']);if(!$email)return null;
 db()->prepare('INSERT OR IGNORE INTO auth_credentials(email,user_id,google_user_id,updated_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM members WHERE lower(trim(email))=?)=1')->execute([$email,$identity['userId'],strpos($identity['userId'],'google:')===0?$identity['userId']:null,now_iso(),$email]);
 $q->execute([$identity['userId']]);return $q->fetch()?:null;
}
function account_recent_google($identity){return ($identity['authMethod']??'')==='google'&&is_numeric($identity['authenticatedAt']??null)&&$identity['authenticatedAt']>time()-600&&$identity['authenticatedAt']<=time()+30;}
function account_google($identity,$linkId=null){
 $q=db()->prepare('SELECT user_id FROM auth_retired_identities WHERE user_id=?');$q->execute([$identity['userId']]);if($q->fetch())throw new RuntimeException('Withdrawn account');
 $check=db()->prepare('SELECT user_id FROM members WHERE user_id=? AND deleted_at IS NOT NULL');$check->execute([$identity['userId']]);if($check->fetch())throw new RuntimeException('Withdrawn account');
 $db=db();$email=account_email($identity['email']);if(!$email)throw new RuntimeException('Invalid email');
 $q=$db->prepare('SELECT * FROM auth_credentials WHERE google_user_id=?');$q->execute([$identity['userId']]);$mapped=$q->fetch();
 if($linkId){
  $q=$db->prepare('SELECT * FROM auth_credentials WHERE user_id=?');$q->execute([$linkId]);$current=$q->fetch();
  if(!$current||$current['email']!==$email||($mapped&&$mapped['user_id']!==$linkId))throw new RuntimeException('Link conflict');
  $db->prepare('UPDATE auth_credentials SET google_user_id=?,updated_at=? WHERE user_id=?')->execute([$identity['userId'],now_iso(),$linkId]);$identity['userId']=$linkId;$identity['email']=$current['email'];return $identity;
 }
 if($mapped){$identity['userId']=$mapped['user_id'];$identity['email']=$mapped['email'];return $identity;}
 $q=$db->prepare('SELECT user_id FROM members WHERE user_id=?');$q->execute([$identity['userId']]);
 if($q->fetch()){member_ensure($identity);account_for_user($identity);return $identity;}
 $q=$db->prepare('SELECT user_id FROM members WHERE lower(trim(email))=?');$q->execute([$email]);if(account_by_email($email)||$q->fetch())throw new RuntimeException('Email already exists');
 $now=now_iso();$db->beginTransaction();try{
  $db->prepare("INSERT INTO members(user_id,display_name,created_at,email,role,updated_at) SELECT ?,?,?,?,'preliminary',? WHERE NOT EXISTS(SELECT 1 FROM members WHERE lower(trim(email))=?)")->execute([$identity['userId'],mb_substr($identity['displayName'],0,30,'UTF-8')?:'회원',$now,$email,$now,$email]);
  $db->prepare('INSERT INTO auth_credentials(email,user_id,google_user_id,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE user_id=?)')->execute([$email,$identity['userId'],$identity['userId'],$now,$identity['userId']]);$db->commit();
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
 if(!account_for_user($identity))throw new RuntimeException('Account conflict');member_ensure($identity);return $identity;
}
function account_rate($key,$limit=8){
 $db=db();$now=time();$db->beginTransaction();try{
  $db->prepare('DELETE FROM auth_rate_limits WHERE expires_at<=?')->execute([$now]);
  $db->prepare('INSERT OR IGNORE INTO auth_rate_limits(key,count,expires_at) VALUES(?,0,?)')->execute([$key,$now+900]);
  $q=$db->prepare('UPDATE auth_rate_limits SET count=count+1 WHERE key=? AND count<?');$q->execute([$key,$limit]);$allowed=$q->rowCount()>0;$db->commit();return $allowed;
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
function account_status(){
 $identity=user();if($identity)member($identity);$account=$identity?account_for_user($identity):null;
 json_response(['csrf'=>csrf_token(),'authenticated'=>(bool)$identity,'email'=>$identity['email']??'','passwordConfigured'=>!empty($account['password_hash']),'googleLinked'=>!empty($account['google_user_id']),'resetReady'=>reset_ready(),'recentGoogle'=>$identity&&account_recent_google($identity)]);
}
function account_session($id,$email,$name){$q=db()->prepare('SELECT session_version FROM auth_credentials WHERE user_id=?');$q->execute([$id]);$version=(int)$q->fetchColumn();set_cookie('argo_session',sign_value(['type'=>'session','userId'=>$id,'email'=>$email,'displayName'=>$name,'authMethod'=>'password','sessionVersion'=>$version,'authenticatedAt'=>time(),'exp'=>time()+604800]),604800);}
function account_failure($action,$error){redirect_to('/login?mode='.($action==='register'?'signup':($action==='password'?'manage':'login')).'&error='.$error);}
function account_action($action){
 if(($_SERVER['REQUEST_METHOD']??'')!=='POST'){header('Allow: POST');json_response(['error'=>'method-not-allowed'],405);}
 if(!in_array($action,['login','register','password','forgot','reset','withdraw'],true))json_response(['error'=>'not-found'],404);
 $origin=$_SERVER['HTTP_ORIGIN']??'';if($origin===''||($origin!==request_origin()&&$origin!==config()['app_origin']))json_response(['error'=>'different-origin'],403);
 if(strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE']??'')[0]))!=='application/x-www-form-urlencoded'||(int)($_SERVER['CONTENT_LENGTH']??0)>8192)account_failure($action,'invalid');
 $raw=file_get_contents('php://input',false,null,0,8193);if(strlen($raw)>8192)account_failure($action,'invalid');$form=parse_form($raw);if(!$form)account_failure($action,'invalid');
 $csrf=$_COOKIE['argo_csrf']??'';if(!is_string($csrf)||!preg_match('/^[a-f0-9]{64}$/D',$csrf)||!is_string($form['_csrf']??null)||!hash_equals($csrf,$form['_csrf']))json_response(['error'=>'refresh-form'],403);
 $email=account_email($form['email']??null);$password=$form['password']??'';
 try{
  if($action==='forgot'||$action==='reset')account_recovery($action,$form);
  if($action==='withdraw'){$actor=user();if(!$actor)account_failure($action,'authentication');account_withdraw($actor,$form);}
  $key=$action==='password'?'password:'.substr($_COOKIE['argo_session']??'',-24):$action.':'.($email??'invalid');if(!account_rate($key))account_failure($action,'rate');$db=db();
  if($action==='register'){
   if(!$email)account_failure($action,'email');if(!account_password_valid($password)||($form['confirmPassword']??'')!==$password)account_failure($action,'password');if(($form['consent']??'')!=='yes')account_failure($action,'consent');
   $q=$db->prepare('SELECT user_id FROM members WHERE lower(trim(email))=?');$q->execute([$email]);if(account_by_email($email)||$q->fetch())account_failure($action,'duplicate');
   $id='local:'.bin2hex(random_bytes(16));$name=mb_substr(trim($form['displayName']??'')?:explode('@',$email)[0],0,30,'UTF-8');$hash=account_hash($password);$now=now_iso();
   $db->beginTransaction();try{$db->prepare("INSERT INTO members(user_id,display_name,created_at,email,role,updated_at) VALUES(?,?,?,?,'preliminary',?)")->execute([$id,$name,$now,$email,$now]);$db->prepare('INSERT INTO auth_credentials(email,user_id,password_hash,updated_at) VALUES(?,?,?,?)')->execute([$email,$id,$hash,$now]);$db->commit();}catch(Throwable $e){if($db->inTransaction())$db->rollBack();account_failure($action,'duplicate');}
   account_session($id,$email,$name);redirect_to('/members?saved=registered');
  }
  if($action==='login'){
   if(!$email||strlen($password)>128)account_failure($action,'credentials');$account=account_by_email($email);$valid=account_verify($password,$account['password_hash']??null);
   if(!$valid){$q=$db->prepare('SELECT user_id FROM members WHERE lower(trim(email))=?');$q->execute([$email]);if(empty($account['password_hash'])&&$q->fetch())account_failure($action,'setup');account_failure($action,'credentials');}
   $q=$db->prepare('SELECT display_name FROM members WHERE user_id=?');$q->execute([$account['user_id']]);$member=$q->fetch();if(!$member)account_failure($action,'credentials');
   $db->prepare('DELETE FROM auth_rate_limits WHERE key=?')->execute([$key]);account_session($account['user_id'],$account['email'],$member['display_name']);redirect_to(safe_path($form['return_to']??'/members'));
  }
  $identity=user();if(!$identity)account_failure($action,'authentication');member($identity);$account=account_for_user($identity);if(!$account)account_failure($action,'duplicate');
  if(!account_password_valid($password)||($form['confirmPassword']??'')!==$password)account_failure($action,'password');
  if(!account_recent_google($identity)&&!account_verify($form['currentPassword']??'',$account['password_hash']))account_failure($action,'reauth');
  $db->prepare('UPDATE auth_credentials SET password_hash=?,updated_at=? WHERE user_id=?')->execute([account_hash($password),now_iso(),$identity['userId']]);redirect_to('/login?mode=manage&saved=password');
 }catch(Throwable $e){error_log('[argo] Email authentication failed');account_failure($action,'busy');}
}
