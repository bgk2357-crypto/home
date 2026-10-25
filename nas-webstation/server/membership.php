<?php
function member_owner_email(){return strtolower(trim(config()['master_email']??'bgk2357@gmail.com'));}
function member_columns(){return 'user_id AS userId,display_name AS displayName,created_at AS createdAt,email,role,business_name AS businessName,business_size AS businessSize,contact_name AS contactName,job_title AS jobTitle,phone,profile_completed_at AS profileCompletedAt,updated_at AS updatedAt,version';}
function member_ensure($identity){
    $db=db();$email=strtolower($identity['email']);$now=now_iso();
    $q=$db->prepare("INSERT INTO members(user_id,display_name,created_at,email,role,updated_at) VALUES(?,?,?,?,'preliminary',?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email");$q->execute([$identity['userId'],mb_substr($identity['displayName'],0,30,'UTF-8')?:'회원',$now,$email,$now]);
    if($email===member_owner_email()){
        $db->beginTransaction();try{
            $q=$db->prepare("UPDATE members SET role='master',updated_at=?,version=version+1 WHERE user_id=? AND role!='master'");$q->execute([$now,$identity['userId']]);
            if($q->rowCount())$db->prepare("INSERT INTO member_audit(operation_id,actor_id,target_id,action,old_role,new_role,reason,created_at) VALUES(?,?,?,'bootstrap_master','','master','소유자가 지정한 Google 인증 계정',?)")->execute([bin2hex(random_bytes(16)),$identity['userId'],$identity['userId'],$now]);
            $db->commit();
        }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    }
    $q=$db->prepare('SELECT '.member_columns().' FROM members WHERE user_id=?');$q->execute([$identity['userId']]);$result=$q->fetch();if($result)$result['version']=(int)$result['version'];return $result?:null;
}
function member_master($member){return $member&&($member['role']??'')==='master';}
function member_complete($m){foreach(['businessName','businessSize','contactName','jobTitle','phone'] as $key)if(!is_string($m[$key]??null)||trim($m[$key])==='')return false;return true;}
function member_can_write($m){return member_master($m)||($m&&in_array($m['role']??'',['general','paid'],true)&&member_complete($m));}
function member_requests($id){$q=db()->prepare('SELECT id,user_id AS userId,status,note,created_at AS createdAt,reviewed_at AS reviewedAt,review_note AS reviewNote,amount,payment_reference AS paymentReference FROM member_paid_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 20');$q->execute([$id]);$rows=$q->fetchAll();foreach($rows as &$row)$row['amount']=(int)$row['amount'];unset($row);return $rows;}
function member_admin($page,$search='',$role=''){
    $where='1=1';$args=[];
    if(is_string($search)&&trim($search)!==''){$q=mb_substr(trim($search),0,100,'UTF-8');$where.=' AND (instr(lower(email),lower(?))>0 OR instr(lower(display_name),lower(?))>0 OR instr(lower(business_name),lower(?))>0)';$args=[$q,$q,$q];}
    if(in_array($role,['preliminary','general','paid','master'],true)){$where.=' AND role=?';$args[]=$role;}
    $q=db()->prepare('SELECT count(*) FROM members WHERE '.$where);$q->execute($args);$total=(int)$q->fetchColumn();$pages=max(1,(int)ceil($total/20));$current=max(1,min($pages,$page));
    $q=db()->prepare('SELECT '.member_columns().' FROM members WHERE '.$where.' ORDER BY created_at DESC,user_id LIMIT 20 OFFSET '.(($current-1)*20));$q->execute($args);$members=$q->fetchAll();foreach($members as &$member)$member['version']=(int)$member['version'];unset($member);
    $requests=db()->query("SELECT r.id,r.user_id AS userId,r.status,r.note,r.created_at AS createdAt,r.reviewed_at AS reviewedAt,r.review_note AS reviewNote,r.amount,r.payment_reference AS paymentReference,m.display_name AS author,m.email,m.business_name AS businessName,m.version FROM member_paid_requests r JOIN members m ON m.user_id=r.user_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 100")->fetchAll();
    $audit=db()->query('SELECT id,actor_id AS actorId,target_id AS targetId,action,old_role AS oldRole,new_role AS newRole,reason,created_at AS createdAt FROM member_audit ORDER BY id DESC LIMIT 50')->fetchAll();
    foreach($requests as &$request){$request['amount']=(int)$request['amount'];$request['version']=(int)$request['version'];}unset($request);
    return ['members'=>$members,'total'=>$total,'pages'=>$pages,'current'=>$current,'requests'=>$requests,'audit'=>$audit];
}
function member_action($action){
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'){header('Allow: POST');json_response(['error'=>'method-not-allowed'],405);}
    $origin=$_SERVER['HTTP_ORIGIN']??'';if($origin===''||($origin!==config()['app_origin']&&$origin!==request_origin()))json_response(['error'=>'different-origin'],403);
    $identity=user();if(!$identity)json_response(['error'=>'authentication-required'],401);$m=member($identity);
    $admin=strpos($action,'admin-')===0||$action==='qna-answer';if($admin&&!member_master($m))json_response(['error'=>'master-required'],403);
    $path=$admin?'/admin/members':'/members';
    if(strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE']??'')[0]))!=='application/x-www-form-urlencoded'||(int)($_SERVER['CONTENT_LENGTH']??0)>32768)redirect_to($path.'?error=invalid');
    $form=parse_form(file_get_contents('php://input',false,null,0,32769));if(!$form)redirect_to($path.'?error=invalid');
    if(!is_string($_COOKIE['argo_csrf']??null)||!is_string($form['_csrf']??null)||strlen($_COOKIE['argo_csrf'])!==64||!hash_equals($_COOKIE['argo_csrf'],$form['_csrf']))json_response(['error'=>'refresh-form'],403);
    $db=db();$now=now_iso();
    if($action==='member-profile'||$action==='join'){
        $name=field($form,'displayName',30);$business=field($form,'businessName',120);$size=field($form,'businessSize',30);$contact=field($form,'contactName',60);$title=field($form,'jobTitle',80);$phone=field($form,'phone',30);
        if(!$name||!$business||!in_array($size,['5인 미만','5~19인','20~49인','50~99인','100~299인','300인 이상'],true)||!$contact||!$title||!$phone||!preg_match('/^\+?[0-9 ()-]+$/D',$phone)||strlen(preg_replace('/\D/','',$phone))<7||strlen(preg_replace('/\D/','',$phone))>15||($form['consent']??'')!=='yes')redirect_to($path.'?error=invalid');
        foreach([$name,$business,$contact,$title] as $value)if(preg_match('/[\x00-\x1f\x7f]/',$value))redirect_to($path.'?error=invalid');
        $db->prepare("UPDATE members SET display_name=?,business_name=?,business_size=?,contact_name=?,job_title=?,phone=?,profile_completed_at=COALESCE(profile_completed_at,?),updated_at=?,role=CASE WHEN role IN ('paid','master') THEN role ELSE 'general' END,version=version+1 WHERE user_id=?")->execute([$name,$business,$size,$contact,$title,$phone,$now,$now,$identity['userId']]);redirect_to('/members?saved=profile');
    }
    if($action==='paid-request'){
        if(!member_can_write($m)||$m['role']!=='general')json_response(['error'=>'general-member-required'],403);
        $note=field($form,'note',500);if(!$note||($form['consent']??'')!=='yes')redirect_to($path.'?error=invalid');
        $db->prepare("INSERT INTO member_paid_requests(id,user_id,note,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM member_paid_requests WHERE user_id=? AND status='pending')")->execute([bin2hex(random_bytes(16)),$identity['userId'],$note,$now,$identity['userId']]);redirect_to('/members?saved=request');
    }
    if($action==='paid-cancel'){$id=field($form,'requestId',80);if(!$id)redirect_to($path.'?error=invalid');$db->prepare("UPDATE member_paid_requests SET status='cancelled',reviewed_at=? WHERE id=? AND user_id=? AND status='pending'")->execute([$now,$id,$identity['userId']]);redirect_to('/members?saved=cancelled');}
    if($action==='qna-answer'){
        $id=field($form,'postId',20);$answer=field($form,'answer',10000);if(!$id||!ctype_digit($id)||!$answer)redirect_to('/qna?error=invalid');
        $q=$db->prepare("UPDATE posts SET answer=?,answered_at=?,answered_by=? WHERE id=? AND kind='qna'");$q->execute([$answer,$now,$identity['userId'],(int)$id]);redirect_to('/qna?'.($q->rowCount()?'saved=1':'error=invalid'));
    }
    if($action==='admin-grade'||$action==='admin-paid-review'){
        $id=field($form,'userId',300);$version=field($form,'version',20);$reason=field($form,'reason',500);if(!$id||$version===null||!ctype_digit($version)||!$reason)redirect_to($path.'?error=invalid');
        $db->beginTransaction();try{
            $q=$db->prepare('SELECT '.member_columns().' FROM members WHERE user_id=?');$q->execute([$id]);$target=$q->fetch();
            if(!$target){$db->rollBack();redirect_to($path.'?error=invalid');}
            if(strtolower($target['email'])===member_owner_email()){$db->rollBack();redirect_to($path.'?error=owner');}
            $requestId=field($form,'requestId',80);$decision=field($form,'decision',20);$next=field($form,'role',20);
            if($action==='admin-paid-review'){
                $q=$db->prepare("SELECT id FROM member_paid_requests WHERE id=? AND user_id=? AND status='pending'");$q->execute([$requestId,$id]);
                if(!$q->fetch()||!in_array($decision,['approve','reject'],true)){$db->rollBack();redirect_to($path.'?error=stale');}
                $next=$decision==='approve'?'paid':$target['role'];
            }
            if((int)$target['version']!==(int)$version){$db->rollBack();redirect_to($path.'?error=stale');}
            if(!in_array($next,['preliminary','general','paid','master'],true)){$db->rollBack();redirect_to($path.'?error=invalid');}
            if(in_array($next,['general','paid'],true)&&!member_complete($target)){$db->rollBack();redirect_to($path.'?error=profile');}
            if($next==='master'&&($form['confirmMaster']??'')!=='yes'){$db->rollBack();redirect_to($path.'?error=confirm');}
            if($target['role']==='master'&&$next!=='master'&&(int)$db->query("SELECT count(*) FROM members WHERE role='master'")->fetchColumn()<2){$db->rollBack();redirect_to($path.'?error=owner');}
            $approving=$next==='paid'&&($action==='admin-grade'||$decision==='approve');$amount=field($form,'amount',15);$reference=field($form,'paymentReference',200);
            if($approving&&(($form['paymentConfirmed']??'')!=='yes'||!$amount||!ctype_digit($amount)||(int)$amount<1||(int)$amount>1000000000||!$reference)){$db->rollBack();redirect_to($path.'?error=payment');}
            $db->prepare('UPDATE members SET role=?,updated_at=?,version=version+1 WHERE user_id=?')->execute([$next,$now,$id]);
            $what=$action==='admin-grade'?'grade_change':($decision==='approve'?'paid_approved':'paid_rejected');$note=$approving?$reason.' | 결제확인 '.$amount.'원 | '.$reference:$reason;
            $db->prepare('INSERT INTO member_audit(operation_id,actor_id,target_id,action,old_role,new_role,reason,created_at) VALUES(?,?,?,?,?,?,?,?)')->execute([bin2hex(random_bytes(16)),$identity['userId'],$id,$what,$target['role'],$next,$note,$now]);
            if($action==='admin-paid-review')$db->prepare("UPDATE member_paid_requests SET status=?,reviewed_at=?,reviewed_by=?,review_note=?,amount=?,payment_reference=? WHERE id=? AND status='pending'")->execute([$decision==='approve'?'approved':'rejected',$now,$identity['userId'],$reason,$approving?(int)$amount:0,$approving?$reference:'',$requestId]);
            $db->commit();
        }catch(Throwable $e){if($db->inTransaction())$db->rollBack();error_log('[argo] Member change failed');redirect_to($path.'?error=busy');}
        redirect_to($path.'?saved=1');
    }
    json_response(['error'=>'not-found'],404);
}
