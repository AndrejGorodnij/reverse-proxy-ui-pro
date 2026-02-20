<?php
/**
 * List domains with auto-status and SSL cert expiry
 * 
 * Auto-updates status based on DNS:
 *   - DNS resolves to dest IP → active
 *   - DNS doesn't match → dns_error
 *   - Status 'pending' → skip (cert generation in progress)
 * 
 * SSL cert expiry:
 *   - Reads /certs/certificates/live/{domain}/fullchain.pem
 *   - Returns ssl_expiry (date) and ssl_days_left (int)
 *
 * Called via api.php (GET /api/domains)
 */
require_once(__DIR__ . '/../db.php');

$db = MyDB::getInstance();
$result = $db->query('SELECT * FROM domain ORDER BY id DESC');

$updateStmt = $db->prepare('UPDATE domain SET status = :status WHERE id = :id');
$data = [];

while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
    // === DNS check ===
    $dnsIp = @gethostbyname($row['name']);
    if ($dnsIp === $row['name']) $dnsIp = null;
    $row['dns_ip'] = $dnsIp;

    // Auto-update status (skip pending)
    $oldStatus = $row['status'];
    if ($oldStatus !== 'pending') {
        $newStatus = ($dnsIp !== null && $dnsIp === $row['ip']) ? 'active' : 'dns_error';
        if ($newStatus !== $oldStatus) {
            $updateStmt->reset();
            $updateStmt->bindValue(':status', $newStatus, SQLITE3_TEXT);
            $updateStmt->bindValue(':id', $row['id'], SQLITE3_INTEGER);
            $updateStmt->execute();
            $row['status'] = $newStatus;
        }
    }

    // === SSL cert expiry ===
    $certPath = "/certs/certificates/live/{$row['name']}/fullchain.pem";
    $row['ssl_expiry'] = null;
    $row['ssl_days_left'] = null;

    if (file_exists($certPath)) {
        $certContent = @file_get_contents($certPath);
        if ($certContent) {
            $certInfo = @openssl_x509_parse($certContent);
            if ($certInfo && isset($certInfo['validTo_time_t'])) {
                $expiry = $certInfo['validTo_time_t'];
                $row['ssl_expiry'] = date('Y-m-d', $expiry);
                $row['ssl_days_left'] = max(0, (int) floor(($expiry - time()) / 86400));
            }
        }
    }

    $data[] = $row;
}

// Apply status filter
$statusFilter = $_GET['status'] ?? '';
$allowed = ['new', 'active', 'failed', 'pending', 'dns_error'];
if ($statusFilter && in_array($statusFilter, $allowed)) {
    $data = array_values(array_filter($data, fn($d) => $d['status'] === $statusFilter));
}

jsonResponse($data);