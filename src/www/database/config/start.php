<?php
/**
 * Generate SSL certificates and nginx configs — with SSE progress streaming
 * Called via api.php (POST /api/domains/generate)
 */

// Switch to SSE mode for real-time progress
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

ini_set('display_errors', 0);
ob_implicit_flush(true);
if (ob_get_level()) ob_end_flush();

function sendSSE(string $type, string $message): void
{
    echo "data: " . json_encode(['type' => $type, 'message' => $message]) . "\n\n";
    flush();
}

require_once(__DIR__ . '/../db.php');

$input = getJsonInput();
$ip = trim($input['ip'] ?? '');

if (empty($ip)) {
    sendSSE('error', 'Destination IP is required');
    exit;
}

$db = MyDB::getInstance();

// Get all domains
$result = $db->query('SELECT * FROM domain ORDER BY id ASC');
$domains = [];
while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
    $domains[] = $row;
}

if (empty($domains)) {
    sendSSE('error', 'No domains found');
    exit;
}

// Get server public IP
$serverIP = trim(shell_exec('curl -s https://ipinfo.io/ip') ?? '');
sendSSE('info', "Server IP: $serverIP");
sendSSE('info', "Destination IP: $ip");
sendSSE('info', "Processing " . count($domains) . " domain(s)...");

$certs = '/certs';
$base = '/etc/nginx/conf.d';
$goodCount = 0;
$failCount = 0;

// Prepare status update statement
$updateStmt = $db->prepare('UPDATE domain SET status = :status, ip = :ip WHERE id = :id');

foreach ($domains as $domain) {
    $d = $domain['name'];
    $domainId = $domain['id'];

    sendSSE('progress', "[$d] Checking DNS...");

    $resolvedIP = gethostbyname($d);

    if ($resolvedIP !== $serverIP) {
        sendSSE('warn', "[$d] DNS points to $resolvedIP, expected $serverIP — skipping");

        $updateStmt->bindValue(':status', 'dns_error', SQLITE3_TEXT);
        $updateStmt->bindValue(':ip', $ip, SQLITE3_TEXT);
        $updateStmt->bindValue(':id', $domainId, SQLITE3_INTEGER);
        $updateStmt->execute();
        $updateStmt->reset();

        $failCount++;
        continue;
    }

    sendSSE('progress', "[$d] DNS OK. Generating certificate...");

    // Update status to pending
    $updateStmt->bindValue(':status', 'pending', SQLITE3_TEXT);
    $updateStmt->bindValue(':ip', $ip, SQLITE3_TEXT);
    $updateStmt->bindValue(':id', $domainId, SQLITE3_INTEGER);
    $updateStmt->execute();
    $updateStmt->reset();

    // Generate certificate
    $cmd = "/usr/bin/certbot certonly -n --agree-tos --no-redirect --webroot "
         . "--register-unsafely-without-email -d " . escapeshellarg($d)
         . " -w /var/www/html"
         . " --config-dir $certs/certificates"
         . " --work-dir $certs/certificates"
         . " --logs-dir $certs/certificates";

    $output = [];
    $status = -1;
    exec($cmd, $output, $status);

    $f1 = "$certs/certificates/live/$d/fullchain.pem";
    $f2 = "$certs/certificates/live/$d/privkey.pem";
    $existPem = is_link($f1) && is_link($f2);

    if ($status !== -1 && $existPem) {
        // Generate nginx config
        $tmpl = file_get_contents('/nginx-templates/vhost-template.txt');
        $tmpl = str_replace('DOMAIN', $d, $tmpl);
        $tmpl = str_replace('DESTINATIONIP', $ip, $tmpl);

        $confFile = "$base/$d.conf";
        file_put_contents($confFile, $tmpl);

        sendSSE('success', "[$d] Certificate OK, config saved");

        $updateStmt->bindValue(':status', 'active', SQLITE3_TEXT);
        $updateStmt->bindValue(':ip', $ip, SQLITE3_TEXT);
        $updateStmt->bindValue(':id', $domainId, SQLITE3_INTEGER);
        $updateStmt->execute();
        $updateStmt->reset();

        $goodCount++;
    } else {
        $certOutput = implode(' ', $output);
        sendSSE('error', "[$d] Certificate failed: $certOutput");

        $updateStmt->bindValue(':status', 'failed', SQLITE3_TEXT);
        $updateStmt->bindValue(':ip', $ip, SQLITE3_TEXT);
        $updateStmt->bindValue(':id', $domainId, SQLITE3_INTEGER);
        $updateStmt->execute();
        $updateStmt->reset();

        $failCount++;
    }
}

// Test nginx config if any domains succeeded
if ($goodCount > 0) {
    sendSSE('info', "Testing nginx configuration...");
    $output = [];
    $status = -1;
    exec('sudo docker exec reverse-proxy nginx -t 2>&1', $output, $status);
    $testResult = implode(' ', $output);

    if ($status === 0) {
        sendSSE('success', "Nginx config test passed: $testResult");
    } else {
        sendSSE('error', "Nginx config test failed: $testResult");
    }
}

sendSSE('done', "Finished! $goodCount active, $failCount failed out of " . count($domains) . " domains");
