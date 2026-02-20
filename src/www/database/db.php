<?php
/**
 * Database singleton with auto-migration
 */
class MyDB
{
    private static ?MyDB $instance = null;
    private SQLite3 $db;

    private function __construct()
    {
        $this->db = new SQLite3('/db/db.db');
        $this->db->enableExceptions(true);
        $this->db->busyTimeout(5000);
        $this->db->exec('PRAGMA journal_mode=WAL');
        $this->migrate();
    }

    public static function getInstance(): MyDB
    {
        if (self::$instance === null) {
            self::$instance = new MyDB();
        }
        return self::$instance;
    }

    private function migrate(): void
    {
        $this->db->exec('
            CREATE TABLE IF NOT EXISTS domain (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                ip TEXT DEFAULT "",
                status TEXT DEFAULT "new",
                date TEXT NOT NULL
            )
        ');
        // Add ip column if missing (upgrade from old schema)
        $result = $this->db->query("PRAGMA table_info(domain)");
        $columns = [];
        while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
            $columns[] = $row['name'];
        }
        if (!in_array('ip', $columns)) {
            $this->db->exec('ALTER TABLE domain ADD COLUMN ip TEXT DEFAULT ""');
        }
    }

    public function prepare(string $sql): SQLite3Stmt
    {
        return $this->db->prepare($sql);
    }

    public function exec(string $sql): bool
    {
        return $this->db->exec($sql);
    }

    public function query(string $sql): SQLite3Result
    {
        return $this->db->query($sql);
    }

    public function lastInsertRowID(): int
    {
        return $this->db->lastInsertRowID();
    }

    public function changes(): int
    {
        return $this->db->changes();
    }
}
