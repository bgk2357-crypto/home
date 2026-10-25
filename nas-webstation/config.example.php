<?php
// Copy to config.php beside this file, or run server/setup.php from SSH.
// Keep the document root set to the public/ directory only.
return [
    'app_origin' => 'https://ssk2357.synology.me',
    'auth_secret' => '', // At least 32 random characters; setup.php generates this.
    'data_dir' => '/volume1/argo-homepage-data', // Outside the web shared folder.
    'google_client_id' => '',
    'google_client_secret' => '',
    'naver_map_client_id' => '',
    'master_email' => 'bgk2357@gmail.com', // 최초 소유자 마스터 Google 계정
    'trusted_proxy_ips' => ['127.0.0.1', '::1'],
];
