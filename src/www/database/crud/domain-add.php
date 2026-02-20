<?php
/**
 * Add domains — batch insert with prepared statements
 * Called via api.php (POST /api/domains)
 */
require_once(__DIR__ . '/../db.php');

$input = getJsonInput();
$names = $input['names'] ?? [];
$ip = trim($input['ip'] ?? '');
$date = date("Y-m-d H:i:s");

if (empty($names) || !is_array($names)) {
    jsonError('Names array is required');
}

if (empty($ip)) {
    jsonError('IP is required');
}

$db = MyDB::getInstance();
$stmt = $db->prepare('INSERT OR IGNORE INTO domain (name, ip, status, date) VALUES (:name, :ip, :status, :date)');

$added = 0;
$errors = [];

foreach ($names as $name) {
    $name = trim(strtolower($name));
    if (empty($name)) continue;

    // Basic domain validation
    if (!preg_match('/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/', $name)) {
        $errors[] = "Invalid domain: $name";
        continue;
    }

    $stmt->bindValue(':name', $name, SQLITE3_TEXT);
    $stmt->bindValue(':ip', $ip, SQLITE3_TEXT);
    $stmt->bindValue(':status', 'new', SQLITE3_TEXT);
    $stmt->bindValue(':date', $date, SQLITE3_TEXT);

    try {
        $stmt->execute();
        $stmt->reset();
        if ($db->changes() > 0) {
            $added++;
        }
    } catch (Exception $e) {
        $errors[] = "Error adding $name: " . $e->getMessage();
    }
}

jsonResponse([
    'success' => true,
    'added' => $added,
    'errors' => $errors,
]);