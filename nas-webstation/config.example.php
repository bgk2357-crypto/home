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
    // Password reset: recipient is the member's registered email. Set a verified sender privately.
    'mail_transport' => '', // 'mail' for configured NAS PHP mail(), or 'api' (Resend-compatible JSON)
    'mail_from' => '',
    'mail_api_url' => 'https://api.resend.com/emails',
    'mail_api_key' => '', // Private config.php only; never share or put in public/.
    'trusted_proxy_ips' => ['127.0.0.1', '::1'],
];
