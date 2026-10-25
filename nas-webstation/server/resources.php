<?php
// Persist posts and attachments together in the existing private SQLite database.
function resource_categories() { return ['가이드','서식','교육자료','사례','기타']; }
function resource_empty() { return ['items'=>[], 'total'=>0, 'pages'=>1, 'current'=>1]; }
function resource_files($post_id) {
    $q=db()->prepare('SELECT id,name,size FROM safety_files WHERE post_id=? ORDER BY id'); $q->execute([$post_id]); return $q->fetchAll();
}
function resource_list($page, $search='', $category='') {
    $where='published=1'; $args=[];
    if(is_string($search) && trim($search)!=='') { $search=mb_substr(trim($search),0,100,'UTF-8'); $where.=' AND (instr(lower(title),lower(?))>0 OR instr(lower(body),lower(?))>0)'; $args[]=$search; $args[]=$search; }
    if(in_array($category,resource_categories(),true)) { $where.=' AND category=?'; $args[]=$category; }
    $count=db()->prepare('SELECT COUNT(*) FROM safety_posts WHERE '.$where);$count->execute($args);$total=(int)$count->fetchColumn();
    $pages=max(1,(int)ceil($total/10));$current=max(1,min($pages,(int)$page));
    $q=db()->prepare('SELECT id,author,category,title,body,created_at AS createdAt FROM safety_posts WHERE '.$where.' ORDER BY created_at DESC,id DESC LIMIT 10 OFFSET ?');
    foreach($args as $i=>$value) $q->bindValue($i+1,$value,PDO::PARAM_STR); $q->bindValue(count($args)+1,($current-1)*10,PDO::PARAM_INT);$q->execute();$items=$q->fetchAll();
    foreach($items as &$item) $item['files']=resource_files($item['id']);unset($item);
    return ['items'=>$items,'total'=>$total,'pages'=>$pages,'current'=>$current];
}
function resource_get($id) {
    if(!is_string($id)||!preg_match('/^[a-zA-Z0-9-]{1,80}$/D',$id))return null;
    $q=db()->prepare('SELECT id,author,category,title,body,created_at AS createdAt FROM safety_posts WHERE id=? AND published=1');$q->execute([$id]);$row=$q->fetch();
    if(!$row)return null;$row['files']=resource_files($id);return $row;
}
function resource_filename($name) { return mb_substr(preg_replace('/[\x00-\x1f\x7f<>:"|?*]/u','_',basename(str_replace('\\','/',$name))),0,150,'UTF-8'); }
function resource_file_valid($name,$bytes) {
    $ext=strtolower(pathinfo($name,PATHINFO_EXTENSION));$size=strlen($bytes);
    if($size<1||$size>5*1024*1024)return false;
    $magic=['pdf'=>"%PDF-",'png'=>"\x89PNG\r\n\x1a\n",'jpg'=>"\xff\xd8\xff",'jpeg'=>"\xff\xd8\xff",'hwp'=>"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"];
    if(isset($magic[$ext]))return substr($bytes,0,strlen($magic[$ext]))===$magic[$ext];
    if(in_array($ext,['hwpx','docx','xlsx','pptx','zip'],true))return substr($bytes,0,4)==="PK\x03\x04";
    return in_array($ext,['txt','csv'],true)&&strpos($bytes,"\0")===false&&mb_check_encoding($bytes,'UTF-8');
}
function resource_upload() {
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'){header('Allow: POST');json_response(['error'=>'method-not-allowed'],405);}
    $origin=$_SERVER['HTTP_ORIGIN']??'';
    if($origin===''||($origin!==config()['app_origin']&&$origin!==request_origin()))json_response(['error'=>'different-origin'],403);
    $identity=user();if(!$identity)json_response(['error'=>'authentication-required'],401);
    $registered=member($identity);if(!member_can_write($registered))json_response(['error'=>'general-member-required'],403);
    $path='/resources/safety-forms?write=1&error=';
    if((int)($_SERVER['CONTENT_LENGTH']??0)>16*1024*1024)redirect_to($path.'file#resource-write');
    if(strpos(strtolower($_SERVER['CONTENT_TYPE']??''),'multipart/form-data;')!==0)redirect_to($path.'invalid#resource-write');
    if(!is_string($_COOKIE['argo_csrf']??null)||!is_string($_POST['_csrf']??null)||strlen($_COOKIE['argo_csrf'])!==64||!hash_equals($_COOKIE['argo_csrf'],$_POST['_csrf']))json_response(['error'=>'refresh-form'],403);
    if(is_string($_POST['body']??null))$_POST['body']=str_replace(["\r\n","\r"],"\n",$_POST['body']);
    $title=field($_POST,'title',100);$body=field($_POST,'body',20000);$category=field($_POST,'category',20);
    if($title===null||$body===null||!in_array($category,resource_categories(),true)||($_POST['consent']??'')!=='public')redirect_to($path.'invalid#resource-write');
    $checked=[];$files=$_FILES['files']??null;
    if($files){
        if(!is_array($files['name']??null)||count($files['name'])>3)redirect_to($path.'file#resource-write');
        foreach($files['name'] as $i=>$original){
            if(!is_string($original)||!isset($files['error'][$i])||!is_int($files['error'][$i]))redirect_to($path.'file#resource-write');
            if($files['error'][$i]===UPLOAD_ERR_NO_FILE)continue;
            if($files['error'][$i]!==UPLOAD_ERR_OK||!is_string($files['tmp_name'][$i]??null)||!is_uploaded_file($files['tmp_name'][$i])||($files['size'][$i]??0)>5*1024*1024)redirect_to($path.'file#resource-write');
            $name=resource_filename($original);$bytes=file_get_contents($files['tmp_name'][$i]);
            if($name===''||$bytes===false||!resource_file_valid($name,$bytes))redirect_to($path.'file#resource-write');
            $checked[]=['name'=>$name,'bytes'=>$bytes];
        }
    }
    $db=db();$id=bin2hex(random_bytes(16));
    try{
        $db->beginTransaction();
        $q=$db->prepare('INSERT INTO safety_posts(id,user_id,author,category,title,body,created_at,published) SELECT ?,?,?,?,?,?,?,0 WHERE (SELECT COUNT(*) FROM safety_posts)<10000 AND (SELECT COUNT(*) FROM safety_posts WHERE user_id=?)<1000');
        $q->execute([$id,$identity['userId'],$registered['displayName'],$category,$title,$body,now_iso(),$identity['userId']]);
        if(!$q->rowCount()){$db->rollBack();redirect_to($path.'capacity');}
        foreach($checked as $file){
            $fid=bin2hex(random_bytes(16));$q=$db->prepare('INSERT INTO safety_files(id,post_id,name,size) VALUES(?,?,?,?)');$q->execute([$fid,$id,$file['name'],strlen($file['bytes'])]);
            $q=$db->prepare('INSERT INTO safety_file_chunks(file_id,part,data) VALUES(?,?,?)');
            foreach(str_split($file['bytes'],32768) as $part=>$chunk)$q->execute([$fid,$part,base64_encode($chunk)]);
        }
        $db->prepare('UPDATE safety_posts SET published=1 WHERE id=?')->execute([$id]);$db->commit();
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();error_log('[argo] Resource upload failed');redirect_to($path.'busy');}
    redirect_to('/resources/safety-forms?post='.$id.'&saved=1');
}
function resource_download() {
    $id=$_GET['file']??'';if(!is_string($id)||!preg_match('/^[a-zA-Z0-9-]{1,80}$/D',$id))json_response(['error'=>'not-found'],404);
    $q=db()->prepare('SELECT f.name,f.size,f.static_path FROM safety_files f JOIN safety_posts p ON p.id=f.post_id WHERE f.id=? AND p.published=1');$q->execute([$id]);$file=$q->fetch();
    if(!$file)json_response(['error'=>'not-found'],404);
    if($file['static_path']){
        if(!in_array($file['static_path'],['/safety/guide.pdf','/safety/seven-elements.png','/safety/seven-checklist.png'],true))json_response(['error'=>'not-found'],404);
        header('Location: '.$file['static_path'],true,302);exit;
    }
    if((int)$file['size']<1||(int)$file['size']>5*1024*1024)json_response(['error'=>'file-unavailable'],500);
    $q=db()->prepare('SELECT part,data FROM safety_file_chunks WHERE file_id=? ORDER BY part');$q->execute([$id]);$bytes='';$part=0;
    while($row=$q->fetch()){$chunk=base64_decode($row['data'],true);if((int)$row['part']!==$part++||$chunk===false)json_response(['error'=>'file-unavailable'],500);$bytes.=$chunk;if(strlen($bytes)>5*1024*1024)json_response(['error'=>'file-unavailable'],500);}
    if(strlen($bytes)!==(int)$file['size'])json_response(['error'=>'file-unavailable'],500);
    header('Content-Type: application/octet-stream');header('Content-Disposition: attachment; filename="download"; filename*=UTF-8\'\''.rawurlencode($file['name']));header('Content-Length: '.strlen($bytes));header('X-Content-Type-Options: nosniff');header('Cache-Control: no-store');echo $bytes;exit;
}
