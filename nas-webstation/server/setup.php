<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$origin = rtrim($argv[1] ?? '', '/'); $data = $argv[2] ?? '/volume1/argo-homepage-data';
$url = parse_url($origin);
if (!$url || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || !empty($url['path']) || isset($url['query']) || isset($url['fragment']) || isset($url['user']) || isset($url['pass'])) { fwrite(STDERR, "Usage: php server/setup.php https://your-domain /volume1/argo-homepage-data\n"); exit(1); }
$file = dirname(__DIR__) . '/config.php';
if (file_exists($file)) { fwrite(STDERR, "config.php already exists; no settings changed.\n"); exit(1); }
$config = require dirname(__DIR__) . '/config.example.php';
$config['app_origin'] = $origin; $config['auth_secret'] = bin2hex(random_bytes(32)); $config['data_dir'] = $data;
umask(0077);
$handle = fopen($file, 'x'); if (!$handle) exit(1);
fwrite($handle, "<?php\nreturn " . var_export($config, true) . ";\n"); fclose($handle);
echo "Created config.php with a random signing key. Configure Google keys and Web Station permissions before use.\n";
