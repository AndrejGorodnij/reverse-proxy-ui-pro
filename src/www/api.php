<?php
/**
 * Central API router with session auth middleware
 */
session_start();

header('Content-Type: application/json');

// Load config
$config = require_once(__DIR__ . '/conf.php');

// Parse request
$method = $_SERVER['REQUEST_METHOD'];

// Route via ?_path= query parameter
$path = isset($_GET['_path']) ? trim($_GET['_path'], '/') : '';

// CORS headers for development
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Auth check middleware ---
function requireAuth(): void
{
    if (empty($_SESSION['authenticated'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

// --- JSON input helper ---
function getJsonInput(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// --- Response helpers ---
function jsonResponse(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function jsonError(string $message, int $code = 400): void
{
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

// --- Route: Login ---
if ($path === 'login' && $method === 'POST') {
    $input = getJsonInput();
    $password = $input['password'] ?? '';

    if (!isset($config['password_hash'])) {
        jsonError('Server not configured', 500);
    }

    if (password_verify($password, $config['password_hash'])) {
        $_SESSION['authenticated'] = true;
        jsonResponse(['success' => true]);
    } else {
        jsonError('Wrong password', 401);
    }
}

// --- Route: Check auth ---
if ($path === 'auth/check' && $method === 'GET') {
    jsonResponse(['authenticated' => !empty($_SESSION['authenticated'])]);
}

// --- Route: Logout ---
if ($path === 'logout' && $method === 'POST') {
    session_destroy();
    jsonResponse(['success' => true]);
}

// --- All routes below require auth ---
requireAuth();

// --- Route: List domains ---
if ($path === 'domains' && $method === 'GET') {
    require_once(__DIR__ . '/database/crud/domain-list.php');
    exit;
}

// --- Route: Add domains ---
if ($path === 'domains' && $method === 'POST') {
    require_once(__DIR__ . '/database/crud/domain-add.php');
    exit;
}

// --- Route: Delete domain(s) ---
if (preg_match('#^domains/delete$#', $path) && $method === 'POST') {
    require_once(__DIR__ . '/database/crud/domain-delete.php');
    exit;
}

// --- Route: Update domain (inline edit) ---
if (preg_match('#^domains/update$#', $path) && $method === 'POST') {
    require_once(__DIR__ . '/database/crud/domain-update.php');
    exit;
}

// --- Route: Generate configs ---
if ($path === 'domains/generate' && $method === 'POST') {
    require_once(__DIR__ . '/database/config/start.php');
    exit;
}

// --- Route: Restart nginx ---
if ($path === 'domains/restart' && $method === 'POST') {
    require_once(__DIR__ . '/database/config/restart.php');
    exit;
}

// --- Route: Status ---
if ($path === 'status' && $method === 'GET') {
    require_once(__DIR__ . '/database/config/status.php');
    exit;
}

// --- 404 ---
jsonError('Not found', 404);
