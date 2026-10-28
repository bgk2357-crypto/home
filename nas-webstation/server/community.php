<?php
function filter_valid($kind,$expression){
 if(!is_string($expression)||trim($expression)===''||mb_strlen($expression,'UTF-8')>80||preg_match('/[\x00-\x1f\x7f~]/',$expression))return false;
 if($kind==='keyword')return true;if($kind!=='regex')return false;
 $rest=preg_replace('/\[(?:\\\\[sdw\-\]\\\\.]|[^\]\\\\])+\]/u','a',$expression);$rest=preg_replace('/\\\\[sdw.\-_]/','a',$rest);$rest=preg_replace('/\{[0-5](?:,[0-5])?\}/','',$rest);
 if(preg_match('/[()\[\]{}|*+?\\\\]/',$rest))return false;return @preg_match('~'.$expression.'~iu','')===0;
}
function filter_rules(){return db()->query('SELECT id,kind,expression FROM content_filters ORDER BY id')->fetchAll();}
function mask_text($text,$rules=null){if($rules===null)$rules=filter_rules();foreach($rules as $r){if(!filter_valid($r['kind'],$r['expression']))continue;$pattern=$r['kind']==='keyword'?preg_quote($r['expression'],'~'):$r['expression'];$text=preg_replace_callback('~'.$pattern.'~iu',function($m){return str_repeat('*',mb_strlen($m[0],'UTF-8'));},$text);}return $text;}
function community_public($row,$identity,$rules,$detail=false,$master=false){
 $own=$identity&&$row['user_id']===$identity['userId'];$out=['id'=>(int)$row['id'],'author'=>mask_text($row['author'],$rules),'body'=>mask_text($row['body'],$rules),'createdAt'=>$row['created_at'],'updatedAt'=>$row['updated_at'],'version'=>(int)$row['version'],'isOwn'=>(bool)$own,'canDelete'=>(bool)($own||$master),'commentCount'=>(int)($row['comment_count']??0)];if(isset($row['title']))$out['title']=mask_text($row['title'],$rules);if($detail&&$own)$out['editable']=['title'=>$row['title']??'','body'=>$row['body']];return $out;
}
function community_api(){
 $method=$_SERVER['REQUEST_METHOD']??'GET';$identity=user();$member=member($identity);$master=member_master($member);$db=db();$rules=filter_rules();
 if($method==='GET'){
  $total=(int)$db->query("SELECT count(*) FROM posts WHERE kind='community'")->fetchColumn();$pages=max(1,(int)ceil($total/10));$current=min($pages,page_number($_GET['page']??1));
  $items=$db->query("SELECT p.*,(SELECT count(*) FROM community_comments c WHERE c.post_id=p.id) AS comment_count FROM posts p WHERE kind='community' ORDER BY id DESC LIMIT 10 OFFSET ".(($current-1)*10))->fetchAll();
  $raw=$_GET['post']??'';$id=is_scalar($raw)&&ctype_digit((string)$raw)?(int)$raw:0;$q=$db->prepare("SELECT * FROM posts WHERE id=? AND kind='community'");$q->execute([$id]);$selected=$q->fetch();
  $q=$db->prepare('SELECT count(*) FROM community_comments WHERE post_id=?');$q->execute([$selected?$id:0]);$ct=(int)$q->fetchColumn();$cp=max(1,(int)ceil($ct/10));$cc=min($cp,page_number($_GET['commentPage']??1));
  $q=$db->prepare('SELECT * FROM community_comments WHERE post_id=? ORDER BY id LIMIT 10 OFFSET '.(($cc-1)*10));$q->execute([$selected?$id:0]);
  $out=['items'=>array_map(function($r)use($identity,$rules,$master){return community_public($r,$identity,$rules,false,$master);},$items),'total'=>$total,'pages'=>$pages,'current'=>$current,'selected'=>$selected?community_public($selected,$identity,$rules,true,$master):null,'comments'=>array_map(function($r)use($identity,$rules,$master){return community_public($r,$identity,$rules,true,$master);},$q->fetchAll()),'commentTotal'=>$ct,'commentPages'=>$cp,'commentCurrent'=>$cc,'csrf'=>csrf_token(),'canWrite'=>member_can_write($member),'authenticated'=>(bool)$identity,'isMaster'=>$master];if($master)$out['rules']=$rules;json_response($out);
 }
 if($method!=='POST')json_response(['error'=>'method'],405);
 $body=content_input();if(!$identity)json_response(['error'=>'authentication'],401);$action=$body['action']??'';$now=now_iso();
 if($action==='rule-add'||$action==='rule-delete'){
  if(!$master)json_response(['error'=>'permission'],403);$db->beginTransaction();try{
  if($action==='rule-add'){$expression=$body['expression']??null;$kind=$body['kind']??'';if(!filter_valid($kind,$expression)||(int)$db->query('SELECT count(*) FROM content_filters')->fetchColumn()>=200){$db->rollBack();json_response(['error'=>'invalid'],400);}$db->prepare('INSERT INTO content_filters(kind,expression,created_at,created_by) VALUES(?,?,?,?)')->execute([$kind,$expression,$now,$identity['userId']]);}
  else{$q=$db->prepare('SELECT expression FROM content_filters WHERE id=?');$q->execute([$body['id']??0]);$expression=$q->fetchColumn();if(!$expression){$db->rollBack();json_response(['error'=>'not-found'],404);}$db->prepare('DELETE FROM content_filters WHERE id=?')->execute([$body['id']]);}
  $db->prepare('INSERT INTO moderation_audit(actor_id,action,expression,created_at) VALUES(?,?,?,?)')->execute([$identity['userId'],$action,$expression,$now]);$db->commit();}catch(Throwable $e){if($db->inTransaction())$db->rollBack();json_response(['error'=>'invalid'],400);}json_response(['ok'=>true]);
 }
 $comment=strpos($action,'comment-')===0;$table=$comment?'community_comments':'posts';$guard=$comment?'':" AND kind='community'";$id=$body['id']??0;$version=$body['version']??0;
 if(in_array($action,['create','comment-create','update','comment-update'],true)){
  $text=field($body,'body',$comment?1000:2000);$title=$comment?'':field($body,'title',100);if($text===null||$title===null)json_response(['error'=>'invalid'],400);
 }
 if($action==='create'||$action==='comment-create'){
  if(!member_can_write($member))json_response(['error'=>'permission'],403);
  if($comment){if(!is_int($body['postId']??null))json_response(['error'=>'invalid'],400);$pid=$body['postId'];$q=$db->prepare("INSERT INTO community_comments(post_id,user_id,author,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND kind='community') AND (SELECT count(*) FROM community_comments WHERE post_id=?)<1000");$q->execute([$pid,$identity['userId'],$member['displayName'],$text,$now,$pid,$pid]);}
  else{$q=$db->prepare("INSERT INTO posts(kind,user_id,author,title,body,created_at) SELECT 'community',?,?,?,?,? WHERE (SELECT count(*) FROM posts WHERE kind='community')<10000");$q->execute([$identity['userId'],$member['displayName'],$title,$text,$now]);}
  if(!$q->rowCount())json_response(['error'=>'invalid'],400);json_response(['ok'=>true,'id'=>(int)$db->lastInsertId()]);
 }
 if(!in_array($action,['update','delete','comment-update','comment-delete'],true)||!is_int($id)||!is_int($version))json_response(['error'=>'invalid'],400);
 if(substr($action,-6)==='delete'){$q=$db->prepare('DELETE FROM '.$table.' WHERE id=? AND version=?'.($master?'':' AND user_id=?').$guard);$args=[$id,$version];if(!$master)$args[]=$identity['userId'];$q->execute($args);}
 else{ $q=$db->prepare('UPDATE '.$table.' SET '.($comment?'':'title=?,').'body=?,updated_at=?,version=version+1 WHERE id=? AND user_id=? AND version=?'.$guard);$args=$comment?[]:[$title];array_push($args,$text,$now,$id,$identity['userId'],$version);$q->execute($args);}
 if(!$q->rowCount())json_response(['error'=>'invalid-or-stale'],409);json_response(['ok'=>true]);
}
