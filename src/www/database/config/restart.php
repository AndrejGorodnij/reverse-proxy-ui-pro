<?php
/**
 * Restart nginx — reload configuration
 * Called via api.php (POST /api/domains/restart)
 */

$cmd = 'sudo docker exec reverse-proxy nginx -s reload 2>&1';
$output = [];
$status = -1;

exec($cmd, $output, $status);
$outputStr = implode("\n", $output);

if ($status === 0) {
    jsonResponse([
        'success' => true,
        'message' => 'Nginx reloaded successfully',
        'output' => $outputStr,
    ]);
} else {
    jsonError('Nginx reload failed: ' . $outputStr, 500);
}
