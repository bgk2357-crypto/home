<?php
// Private, account-scoped MSDS workspace. Compatible with SQLite 3.10.
function workspace_hierarchy($value){
 if($value===null)return [];if(!is_array($value)||count($value)>200)return null;$nodes=[];$ids=[];
 foreach($value as $n){if(!is_array($n)||!is_string($n['id']??null)||!preg_match('/^[-a-zA-Z0-9]{1,80}$/D',$n['id'])||isset($ids[$n['id']])||!is_string($n['parentId']??null)||!is_string($n['name']??null)||trim($n['name'])===''||mb_strlen($n['name'])>80||(!is_int($n['level']??null)||$n['level']<1||$n['level']>200)||!is_string($n['workDetails']??'')||mb_strlen($n['workDetails']??'')>2000)return null;$ids[$n['id']]=true;$nodes[]=['id'=>$n['id'],'parentId'=>$n['parentId'],'name'=>trim($n['name']),'level'=>$n['level']];if(($n['workDetails']??'')!=='')$nodes[count($nodes)-1]['workDetails']=$n['workDetails'];}
 foreach($nodes as $n){$parent=null;foreach($nodes as $p){if($p['id']===$n['parentId'])$parent=$p;if($p['id']!==$n['id']&&$p['parentId']===$n['parentId']&&$p['name']===$n['name'])return null;}if($n['level']===1?$n['parentId']!=='':(!$parent||$parent['level']!==$n['level']-1))return null;}return $nodes;
}
function workspace_assignment($nodes,$id){$path=[];$current=$id;for($i=0;$i<200;$i++){$found=null;foreach($nodes as $n)if($n['id']===$current){$found=$n;break;}if(!$found)break;array_unshift($path,$found);$current=$found['parentId'];}return ['categoryId'=>$id,'category'=>implode(' / ',array_column($path,'name')),'department'=>$path[0]['name']??'','processName'=>$path[1]['name']??'','taskName'=>implode(' / ',array_column(array_slice($path,2),'name'))];}
function workspace_allowed($m){return $m&&in_array($m['role']??'',['paid','master'],true);}
function workspace_clean($input){
 if(!is_array($input)||!is_string($input['id']??null)||!preg_match('/^[-a-zA-Z0-9]{1,80}$/D',$input['id']))return null;
 $out=['id'=>$input['id']];
 $fields=explode(',','fileName,importedAt,product,supplier,address,phone,workplace,department,cas,ingredients,signal,hazards,precautions,firstAid,fire,spill,handling,protection,text,emergencyPhone,recommendedUse,restrictions,classification,category,groupName,msdsNumber,hCodes,regulationNotes,specialNotes,managementNotes,processName,postingLocation,categoryId,taskName,matrixProduct');
 foreach($fields as $field){$v=$input[$field]??'';$limit=$field==='text'?100000:(in_array($field,['category','taskName'],true)?20000:($field==='groupName'?120:10000));if(!is_string($v)||mb_strlen($v,'UTF-8')>$limit)return null;$out[$field]=$v;}
 $out['pictograms']=[];foreach(is_array($input['pictograms']??null)?$input['pictograms']:[] as $code)if(is_string($code)&&preg_match('/^GHS0[1-9]$/D',$code)&&!in_array($code,$out['pictograms'],true))$out['pictograms'][]=$code;
 $out['reviewed']=($input['reviewed']??false)===true;$out['published']=$out['reviewed']&&($input['published']??false)===true;$out['kind']=($input['kind']??'')==='measurement'?'measurement':'msds';if($out['kind']==='measurement')$out['published']=false;
 if(array_key_exists('managementEntries',$input)){
  $entries=$input['managementEntries'];if(!is_array($entries)||count($entries)>100)return null;$out['managementEntries']=[];$entryIds=[];
  foreach($entries as $entry){
   if(!is_array($entry)||!is_string($entry['id']??null)||!preg_match('/^[-a-zA-Z0-9]{1,80}$/D',$entry['id'])||isset($entryIds[$entry['id']]))return null;
   $entryIds[$entry['id']]=true;$clean=['id'=>$entry['id']];
   foreach(['categoryId'=>80,'department'=>200,'processName'=>200,'taskName'=>20000,'workDetails'=>2000,'notes'=>10000,'updatedAt'=>80] as $field=>$limit){$value=$entry[$field]??'';if(!is_string($value)||mb_strlen($value,'UTF-8')>$limit)return null;$clean[$field]=$value;}
   $out['managementEntries'][]=$clean;
  }
 }
 foreach(['components'=>['id','name','cas','concentration','basis','specialCondition','notes'],'measurementRows'=>['id','date','department','process','location','substance','cas','result','unit','limit','limitUnit','period','limitPeriod','notes']] as $key=>$keys){$rows=$input[$key]??[];if(!is_array($rows)||count($rows)>($key==='components'?100:300))return null;$out[$key]=[];foreach($rows as $row){if(!is_array($row))return null;$result=[];foreach($keys as $field){$v=$row[$field]??'';if(!is_string($v)||mb_strlen($v,'UTF-8')>($field==='notes'?1000:200))return null;$result[$field]=$v;}$out[$key][]=$result;}}return $out;
}
function workspace_asset($row){$item=json_decode($row['payload'],true);return array_merge($item,['version'=>(int)$row['version'],'fileSize'=>(int)$row['file_size'],'updatedAt'=>$row['updated_at']]);}
function workspace_event($db,$uid,$previous,$next){
 if(($next['kind']??$previous['kind']??'')==='measurement')return;
 $action=!$next?'delete':(!empty($next['published'])&&empty($previous['published'])?'publish':(empty($next['published'])&&!empty($previous['published'])?'unpublish':(!empty($next['published'])?'update':null)));if(!$action)return;
 $v=$next??$previous;$payload=['assetId'=>$v['id'],'action'=>$action,'product'=>$v['product']?:($v['fileName']??''),'department'=>$v['department']?:($v['category']??''),'processName'=>$v['processName']??'','postingLocation'=>$v['postingLocation']??''];
 $db->prepare('INSERT INTO msds_publication_events(id,user_id,asset_id,payload,created_at) VALUES(?,?,?,?,?)')->execute([bin2hex(random_bytes(16)),$uid,$v['id'],json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),now_iso()]);
}
function workspace_api(){
 $identity=user();if(!$identity)json_response(['error'=>'authentication-required'],401);
 if(!workspace_allowed(member($identity)))json_response(['error'=>'paid-member-required'],403);
 $db=db();$uid=$identity['userId'];$method=$_SERVER['REQUEST_METHOD']??'GET';
 if($method==='GET'){
  $id=$_GET['file']??null;
  if($id!==null){
   if(!is_string($id))json_response(['error'=>'invalid'],400);
   $q=$db->prepare('SELECT * FROM msds_assets WHERE id=? AND user_id=?');$q->execute([$id,$uid]);$row=$q->fetch();if(!$row||!(int)$row['file_size'])json_response(['error'=>'not-found'],404);
   $q=$db->prepare('SELECT part,data FROM msds_original_chunks WHERE asset_id=? ORDER BY part');$q->execute([$id]);$bytes='';$part=0;
   while($chunk=$q->fetch()){$decoded=base64_decode($chunk['data'],true);if($decoded===false||(int)$chunk['part']!==$part++)json_response(['error'=>'file-unavailable'],500);$bytes.=$decoded;if(strlen($bytes)>5*1024*1024)json_response(['error'=>'file-unavailable'],500);}
   if(strlen($bytes)!==(int)$row['file_size'])json_response(['error'=>'file-unavailable'],500);
   $pdf=strtolower(pathinfo($row['file_name'],PATHINFO_EXTENSION))==='pdf';header('Content-Type: '.($pdf?'application/pdf':'application/octet-stream'));header('X-Content-Type-Options: nosniff');header('Cache-Control: no-store');header('Content-Disposition: '.($pdf?'inline':'attachment').'; filename="original"; filename*=UTF-8\'\''.rawurlencode($row['file_name']));echo $bytes;exit;
  }
  $q=$db->prepare('SELECT * FROM msds_assets WHERE user_id=? ORDER BY updated_at DESC,id LIMIT 100');$q->execute([$uid]);$items=array_map('workspace_asset',$q->fetchAll());
  $q=$db->prepare('SELECT id,payload,created_at FROM msds_publication_events WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200');$q->execute([$uid]);$history=array_map(function($r){return array_merge(json_decode($r['payload'],true),['id'=>$r['id'],'createdAt'=>$r['created_at']]);},$q->fetchAll());
  $q=$db->prepare('SELECT payload,version FROM msds_workspace_settings WHERE user_id=?');$q->execute([$uid]);$settings=$q->fetch();$nodes=workspace_hierarchy($settings?(json_decode($settings['payload'],true)['hierarchy']??null):null)??[];foreach($items as &$item)if(!empty($item['categoryId']))$item=array_merge($item,workspace_assignment($nodes,$item['categoryId']));unset($item);
  json_response(['csrf'=>csrf_token(),'history'=>$history,'items'=>$items,'settings'=>$settings?array_merge(['department'=>'','processName'=>'','postingLocation'=>'','hierarchy'=>[]],json_decode($settings['payload'],true),['version'=>(int)$settings['version']]):['businessName'=>'','notice'=>'','categories'=>[],'hierarchy'=>[],'version'=>0,'department'=>'','processName'=>'','postingLocation'=>'']]);
 }
 if($method!=='POST'){header('Allow: GET, POST');json_response(['error'=>'method-not-allowed'],405);}
 if(($_SERVER['HTTP_ORIGIN']??'')!==config()['app_origin']&&($_SERVER['HTTP_ORIGIN']??'')!==request_origin())json_response(['error'=>'different-origin'],403);
 if(empty($_SERVER['HTTP_ORIGIN']))json_response(['error'=>'different-origin'],403);
 if(!is_string($_COOKIE['argo_csrf']??null)||!preg_match('/^[a-f0-9]{64}$/D',$_COOKIE['argo_csrf'])||!hash_equals($_COOKIE['argo_csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??''))json_response(['error'=>'refresh-form'],403);
 if(strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE']??'')[0]))!=='application/json'||(int)($_SERVER['CONTENT_LENGTH']??0)>9*1024*1024)json_response(['error'=>'invalid'],400);
 $raw=file_get_contents('php://input',false,null,0,9*1024*1024+1);if(strlen($raw)>9*1024*1024)json_response(['error'=>'too-large'],413);$body=json_decode($raw,true);
 if(!is_array($body)||!is_int($body['version']??null)||$body['version']<0)json_response(['error'=>'invalid'],400);
 $version=$body['version'];$action=$body['action']??'';
 if($action==='delete-history'){$eventId=$body['id']??'';if(!is_string($eventId))json_response(['error'=>'invalid'],400);$q=$db->prepare('DELETE FROM msds_publication_events WHERE id=? AND user_id=?');$q->execute([$eventId,$uid]);json_response(['ok'=>true],$q->rowCount()?200:404);}
 if($action==='settings'){
  $s=$body['settings']??[];$name=$s['businessName']??'';$notice=$s['notice']??'';$cats=$s['categories']??[];
  if(!is_string($name)||mb_strlen($name)>120||!is_string($notice)||mb_strlen($notice)>3000||!is_array($cats)||count($cats)>50)json_response(['error'=>'invalid'],400);
  foreach($cats as $cat)if(!is_string($cat)||trim($cat)===''||mb_strlen($cat)>120)json_response(['error'=>'invalid'],400);
  $nodes=workspace_hierarchy($s['hierarchy']??null);if($nodes===null)json_response(['error'=>'invalid-hierarchy'],400);
  $extra=['hierarchy'=>$nodes];foreach(['department','processName','postingLocation'] as $key){$v=$s[$key]??'';if(!is_string($v)||mb_strlen($v)>120)json_response(['error'=>'invalid'],400);$extra[$key]=$v;}$payload=json_encode(array_merge(['businessName'=>$name,'notice'=>$notice,'categories'=>array_values(array_unique($cats))],$extra),JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
  $db->beginTransaction();try{
   $refs=$db->prepare('SELECT payload FROM msds_assets WHERE user_id=?');$refs->execute([$uid]);foreach($refs->fetchAll() as $ref){$categoryId=json_decode($ref['payload'],true)['categoryId']??'';if($categoryId&&!in_array($categoryId,array_column($nodes,'id'),true)){$db->rollBack();json_response(['error'=>'classification-in-use'],409);}}
   $q=$db->prepare('SELECT version FROM msds_workspace_settings WHERE user_id=?');$q->execute([$uid]);$old=$q->fetch();if(($old?(int)$old['version']:0)!==$version){$db->rollBack();json_response(['error'=>'stale'],409);}
   if($old)$db->prepare('UPDATE msds_workspace_settings SET payload=?,version=version+1 WHERE user_id=?')->execute([$payload,$uid]);else $db->prepare('INSERT INTO msds_workspace_settings(user_id,payload) VALUES(?,?)')->execute([$uid,$payload]);$db->commit();json_response(['ok'=>true,'version'=>$version+1]);
  }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
 }
 $item=$action==='save'?workspace_clean($body['item']??null):null;$id=$action==='save'?($item['id']??''):($body['id']??'');
 if(!in_array($action,['save','delete'],true)||!is_string($id)||!preg_match('/^[-a-zA-Z0-9]{1,80}$/D',$id)||($action==='save'&&!$item))json_response(['error'=>'invalid'],400);
 $file=$body['file']??null;$bytes=null;$filename='';
 if($file!==null){if(!is_array($file)||!is_string($file['name']??null)||!is_string($file['data']??null))json_response(['error'=>'invalid-file'],400);$filename=resource_filename($file['name']);$bytes=base64_decode($file['data'],true);if($filename===''||$bytes===false||!resource_file_valid($filename,$bytes))json_response(['error'=>'invalid-file'],400);}
 $db->beginTransaction();try{
  $q=$db->prepare('SELECT user_id,version,file_name,file_size,payload FROM msds_assets WHERE id=?');$q->execute([$id]);$old=$q->fetch();
  if($old&&$old['user_id']!==$uid){$db->rollBack();json_response(['error'=>'not-found'],404);}
  if(($old?(int)$old['version']:0)!==$version||(!$old&&$action==='delete')){$db->rollBack();json_response(['error'=>'stale'],409);}
  if($action==='delete'){workspace_event($db,$uid,json_decode($old['payload'],true),null);$db->prepare('DELETE FROM msds_assets WHERE id=? AND user_id=?')->execute([$id,$uid]);$db->commit();json_response(['ok'=>true]);}
  if(!$old){$q=$db->prepare('SELECT COUNT(*) FROM msds_assets WHERE user_id=?');$q->execute([$uid]);if((int)$q->fetchColumn()>=100){$db->rollBack();json_response(['error'=>'capacity'],409);}}
  if(!empty($item['categoryId'])){$q=$db->prepare('SELECT payload FROM msds_workspace_settings WHERE user_id=?');$q->execute([$uid]);$setting=$q->fetch();$nodes=workspace_hierarchy($setting?(json_decode($setting['payload'],true)['hierarchy']??null):null)??[];if(!in_array($item['categoryId'],array_column($nodes,'id'),true)){$db->rollBack();json_response(['error'=>'invalid-classification'],400);}$item=array_merge($item,workspace_assignment($nodes,$item['categoryId']));}
  $name=$bytes!==null?$filename:($old['file_name']??'');$size=$bytes!==null?strlen($bytes):(int)($old['file_size']??0);$now=now_iso();$payload=json_encode($item,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
  if($old)$db->prepare('UPDATE msds_assets SET payload=?,version=version+1,file_name=?,file_size=?,updated_at=?,last_op=? WHERE id=? AND user_id=?')->execute([$payload,$name,$size,$now,bin2hex(random_bytes(16)),$id,$uid]);
  else $db->prepare('INSERT INTO msds_assets(id,user_id,payload,file_name,file_size,updated_at,last_op) VALUES(?,?,?,?,?,?,?)')->execute([$id,$uid,$payload,$name,$size,$now,bin2hex(random_bytes(16))]);
  if($bytes!==null){$db->prepare('DELETE FROM msds_original_chunks WHERE asset_id=?')->execute([$id]);$q=$db->prepare('INSERT INTO msds_original_chunks(asset_id,part,data) VALUES(?,?,?)');foreach(str_split($bytes,32768) as $part=>$chunk)$q->execute([$id,$part,base64_encode($chunk)]);}
  workspace_event($db,$uid,$old?json_decode($old['payload'],true):null,$item);$db->commit();json_response(['ok'=>true,'version'=>$version+1,'fileSize'=>$size,'updatedAt'=>$now]);
 }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
