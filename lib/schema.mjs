export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS field_users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','staff')),permissions TEXT NOT NULL DEFAULT '{}',active INTEGER NOT NULL DEFAULT 1,failed_count INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS field_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES field_users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS field_sessions_expires ON field_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS field_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,document TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO field_state(singleton,revision,document,updated_at) VALUES(1,0,'{}',0)`,
  `CREATE TABLE IF NOT EXISTS field_state_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,revision INTEGER NOT NULL,document TEXT NOT NULL,action TEXT NOT NULL,actor_id TEXT,created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS field_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL)`
];
