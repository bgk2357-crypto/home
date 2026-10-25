<?php
// Installation diagnostics: report capabilities only, never paths or secrets.
ini_set('display_errors', '0');
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function storage_check($name, $callback, $no = 'NO') {
    $blocked = false;
    set_error_handler(function ($level, $message) use (&$blocked) { if (stripos($message, 'open_basedir') !== false) $blocked = true; return true; });
    try { $ok = (bool)$callback(); } catch (Throwable $error) { $ok = false; }
    finally { restore_error_handler(); }
    echo $name . ': ' . ($blocked ? 'BLOCKED_BY_OPEN_BASEDIR' : ($ok ? 'OK' : $no)) . "\n";
    return $ok && !$blocked;
}
$file = dirname(__DIR__) . '/config.php';
if (!storage_check('config_readable', function () use ($file) { return is_file($file) && is_readable($file); })) exit;
$config = null;
if (!storage_check('config_loadable', function () use ($file, &$config) { $config = require $file; return is_array($config); })) exit;
$directory = $config['data_dir'] ?? null;
if (!is_string($directory) || $directory === '') { echo "data_directory_setting: MISSING\n"; exit; }
echo "data_directory_setting: OK\n";
if (!storage_check('data_directory_exists', function () use ($directory) { return is_dir($directory); }, 'MISSING')) exit;
storage_check('data_directory_readable', function () use ($directory) { return is_readable($directory); });
storage_check('data_directory_writable', function () use ($directory) { return is_writable($directory); });
$database = rtrim($directory, '/\\') . '/argo.sqlite';
if (storage_check('database_file_exists', function () use ($database) { return is_file($database); }, 'NOT_CREATED')) {
    storage_check('database_readable', function () use ($database) { return is_readable($database); });
    storage_check('database_writable', function () use ($database) { return is_writable($database); });
}
storage_check('migration_files_readable', function () { $files = glob(dirname(__DIR__) . '/server/migrations/*.sql'); if (!$files) return false; foreach ($files as $file) if (!is_readable($file)) return false; return true; });
