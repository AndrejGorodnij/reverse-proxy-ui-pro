<?php
/**
 * Update domain — edit IP or status via inline editing
 * Called via api.php (POST /api/domains/update)
 */
require_once(__DIR__ . '/../db.php');

$input = getJsonInput();
$id = intval($input['id'] ?? 0);

if ($id <= 0) {
    jsonError('Valid domain ID is required');
}

$db = MyDB::getInstance();

// Build dynamic update
$fields = [];
$params = [];

if (isset($input['ip'])) {
    $ip = trim($input['ip']);
    if (empty($ip)) {
        jsonError('IP cannot be empty');
    }
    $fields[] = 'ip = :ip';
    $params[':ip'] = $ip;
}

if (isset($input['name'])) {
    $name = trim(strtolower($input['name']));
    if (empty($name) || !preg_match('/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/', $name)) {
        jsonError('Invalid domain name');
    }
    $fields[] = 'name = :name';
    $params[':name'] = $name;
}

if (empty($fields)) {
    jsonError('Nothing to update');
}

$sql = 'UPDATE domain SET ' . implode(', ', $fields) . ' WHERE id = :id';
$stmt = $db->prepare($sql);

foreach ($params as $key => $val) {
    $stmt->bindValue($key, $val, SQLITE3_TEXT);
}
$stmt->bindValue(':id', $id, SQLITE3_INTEGER);

try {
    $stmt->execute();
    if ($db->changes() > 0) {
        jsonResponse(['success' => true, 'message' => 'Domain updated']);
    } else {
        jsonError('Domain not found or no changes', 404);
    }
} catch (Exception $e) {
    jsonError('Update failed: ' . $e->getMessage(), 500);
}
