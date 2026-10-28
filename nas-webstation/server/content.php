<?php
function content_input(){
 $origin=$_SERVER['HTTP_ORIGIN']??'';if($origin===''||($origin!==request_origin()&&$origin!==config()['app_origin']))json_response(['error'=>'origin'],403);
 if(strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE']??'')[0]))!=='application/json')json_response(['error'=>'invalid'],400);
 $raw=file_get_contents('php://input',false,null,0,16001);$body=json_decode($raw,true);if(strlen($raw)>16000||!is_array($body))json_response(['error'=>'invalid'],400);
 $csrf=$_COOKIE['argo_csrf']??'';if(!is_string($csrf)||!preg_match('/^[a-f0-9]{64}$/D',$csrf)||!is_string($body['csrf']??null)||!hash_equals($csrf,$body['csrf']))json_response(['error'=>'csrf'],403);return $body;
}
function guest_owner(){ $token=$_COOKIE['argo_guest_owner']??'';if(!is_string($token)||!preg_match('/^[a-f0-9]{64}$/D',$token)){$token=bin2hex(random_bytes(32));set_cookie('argo_guest_owner',$token,31536000);}return hash('sha256',$token); }
function content_api(){
 $method=$_SERVER['REQUEST_METHOD']??'GET';if(!in_array($method,['GET','POST'],true))json_response(['error'=>'method'],405);$b=$method==='POST'?content_input():$_GET;
 $kind=$b['kind']??'';$id=$b['id']??'';if(!is_scalar($id)||!in_array($kind,['guestbook','qna','community','resource'],true))json_response(['error'=>'invalid'],400);
 $table=$kind==='guestbook'?'guestbook':($kind==='resource'?'safety_posts':'posts');$guard=in_array($kind,['qna','community'],true)?' AND kind=?':'';$args=[$id];if($guard)$args[]=$kind;
 $q=db()->prepare('SELECT * FROM '.$table.' WHERE id=?'.$guard);$q->execute($args);$row=$q->fetch();$identity=user();$master=member_master(member($identity));$own=$row&&(($identity&&($row['user_id']??null)===$identity['userId'])||($kind==='guestbook'&&!empty($row['owner_hash'])&&hash_equals($row['owner_hash'],guest_owner())));
 if($method==='GET')json_response(['canDelete'=>(bool)($row&&($master||$own)),'csrf'=>csrf_token()]);
 if(!$row||(!$master&&!$own))json_response(['error'=>'permission'],403);db()->prepare('DELETE FROM '.$table.' WHERE id=?'.$guard)->execute($args);json_response(['ok'=>true]);
}
