<?php
// Minimal capability check; does not load config.php or expose private settings.
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo 'PHP: ' . PHP_VERSION . "\n";
$checks = [
    'mbstring' => extension_loaded('mbstring'),
    'mb_strlen' => function_exists('mb_strlen'),
    'mb_substr' => function_exists('mb_substr'),
    'mb_check_encoding' => function_exists('mb_check_encoding'),
    'mb_convert_encoding' => function_exists('mb_convert_encoding'),
    'mb_strtolower' => function_exists('mb_strtolower'),
    'curl' => function_exists('curl_init') && function_exists('curl_multi_init'),
    'pdo_sqlite' => class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true),
];
foreach ($checks as $name => $enabled) echo $name . ': ' . ($enabled ? 'OK' : 'MISSING') . "\n";
