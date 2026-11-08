<?php

return [
    'control_enabled' => (bool) env('ERP_CONTROL_ENABLED', false),
    'web_setup' => (bool) env('ERP_CONTROL_WEB_SETUP', false),
    'enforce' => (bool) env('ERP_LICENSE_ENFORCE', false),
    'private_key' => env('ERP_LICENSE_PRIVATE_KEY', storage_path('app/control/signing-private.pem')),
    'legacy_public_keys' => env('ERP_LICENSE_LEGACY_PUBLIC_KEYS'),
    'public_key' => env('ERP_LICENSE_PUBLIC_KEY', storage_path('app/control/signing-public.pem')),
    'offline_certificate' => env('ERP_OFFLINE_CERTIFICATE'),
    'device_id' => env('ERP_LICENSE_DEVICE_ID'),
    'machine_hash' => env('ERP_LICENSE_MACHINE_HASH'),
    'company_id' => env('ERP_LICENSE_COMPANY_ID'),
    'issuer' => env('ERP_LICENSE_ISSUER', env('APP_URL', 'http://localhost')),
    'backup_enabled' => (bool) env('ERP_CONTROL_BACKUP_ENABLED', false),
    'backup_password' => env('ERP_CONTROL_BACKUP_PASSWORD'),
    'backup_path' => env('ERP_CONTROL_BACKUP_PATH', storage_path('issuer-backups')),
];
