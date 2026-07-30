// ============================================================
//  SQLite 数据库模块
//  使用 sql.js（纯 JavaScript SQLite，WebAssembly 实现）
//  零原生依赖，跨平台兼容，无需编译
// ============================================================

import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

let SQL = null;
let db = null;
let dbPath = null;

// 顶层 await：模块加载时初始化 SQL.js（WebAssembly 异步加载）
try {
  SQL = await initSqlJs();
} catch (e) {
  console.warn('[db.js] SQL.js 初始化失败:', e.message);
}

// --------------------------------------------------
// 路径选择（优先项目 data 目录，回退系统 tmp）
// --------------------------------------------------
function getDbPath() {
  const projectDb = join(__dirname, '..', 'data', 'egg-chat.db');
  try {
    const dataDir = dirname(projectDb);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    return projectDb;
  } catch {
    return join(tmpdir(), 'egg-chat.db');
  }
}

// --------------------------------------------------
// 持久化：将内存数据库导出到磁盘
// --------------------------------------------------
function saveToDisk() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
  } catch {}
}

// --------------------------------------------------
// 确保数据库已初始化（懒加载）
// --------------------------------------------------
function ensureInit() {
  if (db) return;
  if (!SQL) throw new Error('SQL.js 未初始化');

  dbPath = getDbPath();

  // 从磁盘加载已有数据，或创建新数据库
  let initialData = null;
  if (existsSync(dbPath)) {
    try {
      initialData = new Uint8Array(readFileSync(dbPath));
    } catch {}
  }

  db = initialData ? new SQL.Database(initialData) : new SQL.Database();

  // 启用外键
  db.run('PRAGMA foreign_keys = ON');

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_conv_user_updated
      ON conversations(user_id, updated_at DESC);
  `);

  saveToDisk();
}

// --------------------------------------------------
// 公开 API：初始化数据库（幂等）
// --------------------------------------------------
export function initDatabase() {
  ensureInit();
  return db;
}

// --------------------------------------------------
// 获取数据库实例
// --------------------------------------------------
function getDb() {
  ensureInit();
  return db;
}

// --------------------------------------------------
// 保存对话（UPSERT）
// --------------------------------------------------
export function saveConversationDB(name, messages, userId = 'default') {
  const database = getDb();
  const cleanName = (name || '').replace(/\.json$/, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const convName = cleanName || `chat-${timestamp}`;
  const messagesJson = JSON.stringify(messages);
  const count = messages.length;

  // SQLite UPSERT：有则更新，无则插入
  database.run(`
    INSERT INTO conversations (user_id, name, messages, message_count, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, name) DO UPDATE SET
      messages = excluded.messages,
      message_count = excluded.message_count,
      updated_at = datetime('now')
  `, [userId, convName, messagesJson, count]);

  saveToDisk();
  return convName + '.json';
}

// --------------------------------------------------
// 加载对话
// --------------------------------------------------
export function loadConversationDB(name, userId = 'default') {
  const database = getDb();
  const cleanName = (name || '').replace(/\.json$/, '');

  const stmt = database.prepare(`
    SELECT messages, updated_at FROM conversations
    WHERE user_id = ? AND name = ?
  `);
  stmt.bind([userId, cleanName]);

  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();

  if (!row) return null;

  try {
    const messages = JSON.parse(row.messages);
    return {
      version: '2.0',
      savedAt: row.updated_at,
      messageCount: messages.length,
      messages,
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------
// 列出用户所有对话
// --------------------------------------------------
export function listConversationsDB(userId = 'default') {
  const database = getDb();

  const stmt = database.prepare(`
    SELECT name, message_count, updated_at, messages
    FROM conversations
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `);
  stmt.bind([userId]);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  return rows.map(row => {
    let preview = '未命名对话';
    try {
      const messages = JSON.parse(row.messages || '[]');
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        const text = typeof firstUserMsg.content === 'string'
          ? firstUserMsg.content
          : firstUserMsg.content?.map(p => p.text || '').join('') || '';
        preview = text.slice(0, 30);
      }
    } catch {}

    return {
      filename: row.name + '.json',
      name: row.name,
      savedAt: row.updated_at,
      messageCount: row.message_count,
      preview: preview || '未命名对话',
    };
  });
}

// --------------------------------------------------
// 删除对话
// --------------------------------------------------
export function deleteConversationDB(name, userId = 'default') {
  const database = getDb();
  const cleanName = (name || '').replace(/\.json$/, '');

  database.run(
    'DELETE FROM conversations WHERE user_id = ? AND name = ?',
    [userId, cleanName]
  );
  saveToDisk();
  return true;
}

// --------------------------------------------------
// 关闭数据库（优雅退出）
// --------------------------------------------------
export function closeDatabase() {
  if (db) {
    try { saveToDisk(); db.close(); } catch {}
    db = null;
  }
}
