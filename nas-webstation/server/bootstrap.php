<?php
require_once __DIR__ . "/membership.php";
require_once __DIR__ . "/credentials.php";
// PHP 7.4+; no Composer, Node.js or Docker needed on the NAS.
function config() {
    static $config;
    if ($config !== null) return $config;
    $file = getenv('ARGO_CONFIG_PATH') ?: dirname(__DIR__) . '/config.php';
    if (!is_file($file)) throw new RuntimeException('Run server/setup.php or create config.php first');
    $config = require $file;
    if (!is_array($config) || strlen($config['auth_secret'] ?? '') < 32) throw new RuntimeException('Invalid private configuration');
    return $config;
}
function now_iso() { return gmdate('Y-m-d\TH:i:s.000\Z'); }
function json_response($value, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
function request_origin() {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    if (in_array($_SERVER['REMOTE_ADDR'] ?? '', config()['trusted_proxy_ips'] ?? [], true)) {
        $proto = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')[0]);
        if ($proto === 'https' || $proto === 'http') $https = $proto === 'https';
    }
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (!preg_match('/^[a-zA-Z0-9.\-:\[\]]+$/D', $host)) throw new RuntimeException('Invalid request host');
    return ($https ? 'https://' : 'http://') . strtolower($host);
}
function safe_path($value) {
    if (!is_string($value) || $value === '' || $value[0] !== '/' || substr($value, 0, 2) === '//' || preg_match('/[\\\\\x00-\x20\x7f]/', $value)) return '/';
    $path = parse_url($value, PHP_URL_PATH);
    if (!is_string($path) || strpos($path, '/auth/') === 0 || $path === '/login' || $path === '/index.php') return '/';
    return $value;
}
function route_url($path) {
    $parts = parse_url($path);
    $query = [];
    if (isset($parts['query'])) parse_str($parts['query'], $query);
    unset($query['route']);
    $result = '/index.php?' . http_build_query(array_merge(['route' => $parts['path'] ?? '/'], $query), '', '&', PHP_QUERY_RFC3986);
    return $result . (isset($parts['fragment']) ? '#' . $parts['fragment'] : '');
}
function redirect_to($path) { header('Cache-Control: no-store'); header('Location: ' . route_url($path), true, 303); exit; }
function b64($bytes) { return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '='); }
function sign_value($value) {
    $payload = b64(json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    return $payload . '.' . b64(hash_hmac('sha256', $payload, config()['auth_secret'], true));
}
function read_value($value) {
    if (!is_string($value) || strlen($value) > 6000) return null;
    $parts = explode('.', $value);
    if (count($parts) !== 2 || !hash_equals(b64(hash_hmac('sha256', $parts[0], config()['auth_secret'], true)), $parts[1])) return null;
    $data = json_decode(base64_decode(strtr($parts[0], '-_', '+/'), true) ?: '', true);
    return is_array($data) && is_numeric($data['exp'] ?? null) && $data['exp'] > time() ? $data : null;
}
function set_cookie($name, $value, $seconds) {
    setcookie($name, $value, ['expires' => time() + $seconds, 'path' => '/', 'secure' => strpos(request_origin(), 'https:') === 0, 'httponly' => true, 'samesite' => 'Lax']);
}
function user() {
    $value = read_value($_COOKIE['argo_session'] ?? null);
    if (!$value || ($value['type'] ?? '') !== 'session' || !is_string($value['userId'] ?? null) || (strpos($value['userId'], 'google:') !== 0&&strpos($value['userId'],'local:')!==0) || !is_string($value['email'] ?? null) || !is_string($value['displayName'] ?? null)) return null;
    $check=db()->prepare('SELECT deleted_at FROM members WHERE user_id=?');$check->execute([$value['userId']]);$existing=$check->fetch();if(!empty($existing['deleted_at']))return null;
    if(($value['authMethod']??'')==='password'){$q=db()->prepare('SELECT session_version FROM auth_credentials WHERE user_id=?');$q->execute([$value['userId']]);$account=$q->fetch();if(!$account||(int)$account['session_version']!==($value['sessionVersion']??0))return null;}
    return ['userId' => $value['userId'], 'email' => $value['email'], 'displayName' => $value['displayName'], 'fullName' => $value['fullName'] ?? null,'authMethod'=>($value['authMethod']??'google'),'authenticatedAt'=>$value['authenticatedAt']??null];
}
function csrf_token() {
    $token = $_COOKIE['argo_csrf'] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) { $token = bin2hex(random_bytes(32)); set_cookie('argo_csrf', $token, 604800); }
    return $token;
}
function db() {
    static $db;
    if ($db) return $db;
    $dir = config()['data_dir'];
    if (!is_string($dir) || $dir === '') throw new RuntimeException('Missing private data directory');
    $public = realpath(dirname(__DIR__) . '/public');
    if (!is_dir($dir) && !mkdir($dir, 0700, true)) throw new RuntimeException('Cannot create private data directory');
    $real = realpath($dir);
    if ($public && ($real === $public || strpos(str_replace('\\', '/', $real) . '/', str_replace('\\', '/', $public) . '/') === 0)) throw new RuntimeException('Database must be outside public directory');
    $db = new PDO('sqlite:' . $dir . '/argo.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS _argo_migrations (name TEXT PRIMARY KEY NOT NULL)');
    foreach (glob(__DIR__ . '/migrations/*.sql') as $file) {
        $name = basename($file);
        $db->exec('BEGIN IMMEDIATE');
        try {
            $check = $db->prepare('SELECT name FROM _argo_migrations WHERE name=?'); $check->execute([$name]);
            if (!$check->fetch()) {
                $db->exec(file_get_contents($file));
                $insert = $db->prepare('INSERT INTO _argo_migrations(name) VALUES (?)'); $insert->execute([$name]);
            }
            $db->exec('COMMIT');
        } catch (Throwable $error) { $db->exec('ROLLBACK'); throw $error; }
    }
    return $db;
}
function member($identity) { return $identity ? member_ensure($identity) : null; }
function page_number($value) { return is_scalar($value) && ctype_digit((string)$value) ? max(1, min(10000, (int)$value)) : 1; }
function list_page($kind, $page, $identity = null) {
    if ($kind === 'guestbook') { $from = 'guestbook'; $where = ''; $args = []; $columns = 'id,author,body,created_at AS createdAt'; }
    else { $from = 'posts'; $where = ' WHERE kind=?'; $args = [$kind]; $columns = 'id,kind,user_id AS userId,author,title,body,created_at AS createdAt,answer,answered_at AS answeredAt,answered_by AS answeredBy';
        if ($kind === 'qna' && !member_master(member($identity))) { $where .= ' AND user_id=?'; $args[] = $identity['userId'] ?? ''; }
    }
    $query = db()->prepare('SELECT COUNT(*) FROM ' . $from . $where); $query->execute($args); $total = (int)$query->fetchColumn();
    $pages = max(1, (int)ceil($total / 10)); $current = min($page, $pages);
    $query = db()->prepare('SELECT ' . $columns . ' FROM ' . $from . $where . ' ORDER BY id DESC LIMIT 10 OFFSET ' . (($current - 1) * 10)); $query->execute($args);
    return ['items' => $query->fetchAll(), 'total' => $total, 'pages' => $pages, 'current' => $current];
}
function parse_form($raw) {
    if (strlen($raw) > 32768) return null;
    $form = [];
    foreach (explode('&', $raw) as $pair) {
        if ($pair === '') continue;
        $parts = explode('=', $pair, 2); $key = urldecode($parts[0]); $value = urldecode($parts[1] ?? '');
        if (array_key_exists($key, $form) || !mb_check_encoding($value, 'UTF-8')) return null;
        $form[$key] = $value;
    }
    return $form;
}
function field($form, $name, $maximum, $minimum = 1) {
    $value = $form[$name] ?? null;
    if (!is_string($value)) return null;
    $value = preg_replace('/^\s+|\s+$/u', '', $value); $length = mb_strlen($value, 'UTF-8');
    return $length >= $minimum && $length <= $maximum && strpos($value, "\0") === false ? $value : null;
}
function google_ready() { $c = config(); return !empty($c['google_client_id']) && !empty($c['google_client_secret']) && !empty($c['app_origin']); }
function http_json($url, $post = null, $bearer = null) {
    $curl = curl_init($url); $body = '';
    $headers = ['Accept: application/json']; if ($bearer) $headers[] = 'Authorization: Bearer ' . $bearer;
    if ($post !== null) $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    curl_setopt_array($curl, [CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 7, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_HTTPHEADER => $headers, CURLOPT_WRITEFUNCTION => function ($curl, $chunk) use (&$body) { if (strlen($body) + strlen($chunk) > 1000000) return 0; $body .= $chunk; return strlen($chunk); }]);
    if ($post !== null) curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($post)]);
    $ok = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    if ($ok === false || $status < 200 || $status >= 300) throw new RuntimeException('OAuth provider unavailable');
    return json_decode($body, true, 64, JSON_THROW_ON_ERROR);
}
