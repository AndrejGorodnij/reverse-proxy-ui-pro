<?php
/**
 * Status — check reverse-proxy container status
 * Called via api.php (GET /api/status)
 */

$cmd = 'sudo docker ps --filter name=reverse-proxy --format "{{.Status}}" 2>&1';
$output = [];
$status = -1;

exec($cmd, $output, $status);

jsonResponse([
    'running' => $status === 0 && !empty($output),
    'status' => implode("\n", $output),
]);
