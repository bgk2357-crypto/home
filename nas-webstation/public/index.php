<?php
require dirname(__DIR__) . '/server/bootstrap.php';
require dirname(__DIR__) . '/server/news.php';
require dirname(__DIR__) . '/server/routes.php';
try {
    dispatch();
} catch (Throwable $error) {
    error_log('[argo] ' . $error->getMessage());
    json_response(['error' => 'server-unavailable', 'message' => '서버 설정과 데이터 저장 권한을 확인해주세요.'], 503);
}
