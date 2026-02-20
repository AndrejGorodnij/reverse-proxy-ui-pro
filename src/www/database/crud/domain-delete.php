<?php
/**
 * Delete domain(s) — supports single and bulk delete with prepared statements
 * Called via api.php (POST /api/domains/delete)
 */
require_once(__DIR__ . '/../db.php');

$input = getJsonInput();
$ids = $input['ids'] ?? [];

if (empty($ids) || !is_array($ids)) {
    jsonError('IDs array is required');
}

$db = MyDB::getInstance();
$stmt = $db->prepare('DELETE FROM domain WHERE id = :id');

$deleted = 0;
$errors = [];

foreach ($ids as $id) {
    $id = intval($id);
    if ($id <= 0) {
        $errors[] = "Invalid ID: $id";
        continue;
    }

    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    try {
        $stmt->execute();
        $stmt->reset();
        if ($db->changes() > 0) {
            $deleted++;
        }
    } catch (Exception $e) {
        $errors[] = "Error deleting ID $id: " . $e->getMessage();
    }
}

// Also remove nginx config files for deleted domains
// (they will be regenerated if domains are re-added)

jsonResponse([
    'success' => true,
    'deleted' => $deleted,
    'errors' => $errors,
]);