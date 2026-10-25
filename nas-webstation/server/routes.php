<?php
function oauth_identity($code, $verifier, $request = 'http_json') {
    $c = config(); $redirect = $c['app_origin'] . route_url('/auth/google/callback');
    $token = $request('https://oauth2.googleapis.com/token', ['client_id' => $c['google_client_id'], 'client_secret' => $c['google_client_secret'], 'code' => $code, 'grant_type' => 'authorization_code', 'redirect_uri' => $redirect, 'code_verifier' => $verifier]);
    if (!is_string($token['access_token'] ?? null) || $token['access_token'] === '') throw new RuntimeException('Missing OAuth token');
    $profile = $request('https://openidconnect.googleapis.com/v1/userinfo', null, $token['access_token']);
    if (!is_string($profile['sub'] ?? null) || $profile['sub'] === '' || !is_string($profile['email'] ?? null) || ($profile['email_verified'] ?? null) !== true) throw new RuntimeException('Unverified Google account');
    return ['type' => 'session', 'userId' => 'google:' . $profile['sub'], 'email' => $profile['email'], 'displayName' => mb_substr($profile['name'] ?? $profile['email'], 0, 100, 'UTF-8'), 'fullName' => isset($profile['name']) ? mb_substr($profile['name'], 0, 100, 'UTF-8') : null, 'exp' => time() + 604800];
}
function oauth_start() {
    if (!google_ready()) redirect_to('/login?error=configuration');
    if (request_origin() !== config()['app_origin']) redirect_to('/login?error=origin');
    $state = b64(random_bytes(32)); $verifier = b64(random_bytes(32));
    $flow = ['type' => 'oauth', 'state' => $state, 'verifier' => $verifier, 'returnTo' => safe_path($_GET['return_to'] ?? '/'), 'exp' => time() + 600];
    set_cookie('argo_google_flow', sign_value($flow), 600);
    $query = ['client_id' => config()['google_client_id'], 'redirect_uri' => config()['app_origin'] . route_url('/auth/google/callback'), 'response_type' => 'code', 'scope' => 'openid email profile', 'state' => $state, 'code_challenge' => b64(hash('sha256', $verifier, true)), 'code_challenge_method' => 'S256', 'prompt' => 'select_account'];
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986), true, 303); exit;
}
function oauth_callback() {
    $flow = read_value($_COOKIE['argo_google_flow'] ?? null); set_cookie('argo_google_flow', '', -3600);
    if (request_origin() !== config()['app_origin'] || !$flow || ($flow['type'] ?? '') !== 'oauth' || !is_string($flow['state'] ?? null) || !is_string($_GET['state'] ?? null) || !hash_equals($flow['state'], $_GET['state']) || !is_string($flow['verifier'] ?? null) || !is_string($_GET['code'] ?? null) || $_GET['code'] === '' || isset($_GET['error'])) redirect_to('/login?error=cancelled');
    try { $identity = oauth_identity($_GET['code'], $flow['verifier']); }
    catch (Throwable $error) { error_log('[argo] Google authentication failed'); redirect_to('/login?error=failed'); }
    set_cookie('argo_session', sign_value($identity), 604800); redirect_to(safe_path($flow['returnTo'] ?? '/'));
}
function page_context() {
    $identity = user(); $registered = member($identity); $page = page_number($_GET['page'] ?? '1');
    $path = is_string($_GET['path'] ?? null) ? $_GET['path'] : '/';
    $empty = ['items' => [], 'total' => 0, 'pages' => 1, 'current' => 1];
    $entries = $path === '/guestbook' ? list_page('guestbook', $page) : $empty;
    $posts = $path === '/community' ? list_page('community', $page) : ($path === '/qna' && $registered ? list_page('qna', $page, $identity) : $empty);
    $selected = null; $id = $_GET['post'] ?? '';
    if ($path === '/community' && is_scalar($id) && ctype_digit((string)$id) && (int)$id > 0) {
        $query = db()->prepare("SELECT id,kind,user_id AS userId,author,title,body,created_at AS createdAt FROM posts WHERE kind='community' AND id=?"); $query->execute([(int)$id]); $selected = $query->fetch() ?: null;
    }
    json_response(['user' => $identity, 'member' => $registered, 'entries' => $entries, 'posts' => $posts, 'selected' => $selected, 'googleReady' => google_ready(), 'mapKey' => config()['naver_map_client_id'] ?? '', 'csrf' => csrf_token()]);
}
function action($action) {
    if (!in_array($action, ['guestbook', 'join', 'qna', 'community'], true)) json_response(['error' => 'not-found'], 404);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { header('Allow: POST'); json_response(['error' => 'method-not-allowed'], 405); }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    // TLS may terminate at the NAS proxy, leaving an HTTP/loopback origin here.
    // Accept only the exact configured public origin or the direct request origin;
    // never use client-supplied forwarding headers as an additional allowlist.
    if ($origin !== '' && $origin !== (config()['app_origin'] ?? '') && $origin !== request_origin()) json_response(['error' => 'different-origin'], 403);
    $identity = in_array($action, ['guestbook', 'community'], true) ? null : user();
    if (!in_array($action, ['guestbook', 'community'], true) && !$identity) json_response(['error' => 'authentication-required'], 401);
    $registered = $action === 'qna' ? member($identity) : null;
    if ($action === 'qna' && !$registered) json_response(['error' => 'membership-required'], 403);
    $path = '/' . $action;
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/x-www-form-urlencoded') redirect_to($path . '?error=invalid');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) redirect_to($path . '?error=invalid');
    $raw = file_get_contents('php://input', false, null, 0, 32769); $form = parse_form($raw);
    if (!$form) redirect_to($path . '?error=invalid');
    if (!is_string($_COOKIE['argo_csrf'] ?? null) || !is_string($form['_csrf'] ?? null) || strlen($_COOKIE['argo_csrf']) !== 64 || !hash_equals($_COOKIE['argo_csrf'], $form['_csrf'])) json_response(['error' => 'refresh-form'], 403);
    $db = db(); $now = now_iso();
    if ($action === 'join') {
        $name = field($form, 'displayName', 30, 2); if ($name === null) redirect_to('/join?error=invalid');
        if (($form['consent'] ?? '') !== 'yes') redirect_to('/join?error=consent');
        $query = $db->prepare('INSERT OR IGNORE INTO members (user_id,display_name,created_at) VALUES (?,?,?)'); $query->execute([$identity['userId'], $name, $now]); redirect_to('/members?saved=1');
    }
    if ($action === 'guestbook') {
        $author = field($form, 'author', 30); $body = field($form, 'body', 500);
        if ($author === null || $body === null) redirect_to('/guestbook?error=invalid');
        $query = $db->prepare('INSERT INTO guestbook (author,body,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM guestbook)<2000'); $query->execute([$author, $body, $now]);
    } else {
        $title = field($form, 'title', 100); $body = field($form, 'body', 2000);
        if ($title === null || $body === null) redirect_to($path . '?error=invalid');
        if ($action === 'community') {
            $author = field($form, 'author', 30); if ($author === null) redirect_to($path . '?error=invalid');
            $query = $db->prepare("INSERT INTO posts (kind,user_id,author,title,body,created_at) SELECT 'community',?,?,?,?,? WHERE (SELECT COUNT(*) FROM posts WHERE kind='community')<10000"); $query->execute(['guest:' . bin2hex(random_bytes(16)), $author, $title, $body, $now]);
        } else {
            $query = $db->prepare("INSERT INTO posts (kind,user_id,author,title,body,created_at) SELECT 'qna',?,?,?,?,? WHERE (SELECT COUNT(*) FROM posts WHERE user_id=?)<1000"); $query->execute([$identity['userId'], $registered['displayName'], $title, $body, $now, $identity['userId']]);
        }
    }
    redirect_to($path . ($query->rowCount() ? '?saved=1' : '?error=capacity'));
}
function dispatch() {
    header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: strict-origin-when-cross-origin'); header('Cache-Control: no-store');
    config();
    $route = $_GET['route'] ?? '/'; if (!is_string($route) || !preg_match('#^/[a-zA-Z0-9/_-]*$#D', $route)) json_response(['error' => 'invalid-route'], 400);
    if (strpos($route, '/actions/') === 0) action(substr($route, 9));
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { header('Allow: GET'); json_response(['error' => 'method-not-allowed'], 405); }
    if ($route === '/api/page') page_context();
    if ($route === '/api/health') {
        $checks = ['connection' => false, 'guestbook' => false, 'community' => false];
        try { $db = db(); $db->query('SELECT 1')->fetchColumn(); $checks['connection'] = true; $db->query('SELECT id,author,body,created_at FROM guestbook LIMIT 1')->fetchAll(); $checks['guestbook'] = true; $db->query("SELECT id,author,title,body,created_at FROM posts WHERE kind='community' LIMIT 1")->fetchAll(); $checks['community'] = true; }
        catch (Throwable $error) { json_response(['status' => 'unavailable', 'runtime' => 'php', 'checks' => $checks], 503); }
        json_response(['status' => 'ok', 'runtime' => 'php', 'checks' => $checks]);
    }
    if ($route === '/api/news') {
        $kind = $_GET['kind'] ?? ''; if ($kind !== 'general' && $kind !== 'trends') json_response(['error' => 'invalid-kind'], 400);
        json_response(news_result($kind));
    }
    if ($route === '/auth/google') oauth_start();
    if ($route === '/auth/google/callback') oauth_callback();
    if ($route === '/auth/logout') { set_cookie('argo_session', '', -3600); set_cookie('argo_google_flow', '', -3600); redirect_to(safe_path($_GET['return_to'] ?? '/')); }
    if (strpos($route, '/api/') === 0 || strpos($route, '/auth/') === 0) json_response(['error' => 'not-found'], 404);
    header('Content-Type: text/html; charset=utf-8'); readfile(dirname(__DIR__) . '/public/shell.html');
}
