// ============================================================
//  SQLite 数据库模块
//  替代文件存储，提供原子读写和更好性能
//  使用 better-sqlite3 同步 API，与现有代码完全兼容
// ============================================================

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db = null;

// --------------------------------------------------
// 选择数据库文件路径（优先项目 data 目录，回退系统 tmp）
// --------------------------------------------------
function getDbPath() {
  const projectDb = join(__dirname, '..', 'data', 'egg-chat.db');
  try {
    const dataDir = dirname(projectDb);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    return projectDb;
  } catch {
    return join(tmpdir(), 'egg-chat.db');
  }
}

// --------------------------------------------------
// 初始化数据库：建表 + WAL 模式 + 外键
// --------------------------------------------------
export function initDatabase() {
  if (db) return db; // 已初始化

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // 性能优化
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

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

  return db;
}

// --------------------------------------------------
// 获取数据库实例（不初始化）
// --------------------------------------------------
function getDb() {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return db;
}

// --------------------------------------------------
// 保存对话（UPSERT: 存在则更新，不存在则插入）
// --------------------------------------------------
export function saveConversationDB(name, messages, userId = 'default') {
  const database = getDb();
  const cleanName = (name || '').replace(/\.json$/, ''); // 去除 .json 后缀
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const convName = cleanName || `chat-${timestamp}`;
  const messagesJson = JSON.stringify(messages);
  const count = messages.length;

  const stmt = database.prepare(`
    INSERT INTO conversations (user_id, name, messages, message_count, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, name) DO UPDATE SET
      messages = excluded.messages,
      message_count = excluded.message_count,
      updated_at = datetime('now')
  `);

  stmt.run(userId, convName, messagesJson, count);
  return convName + '.json'; // 保持返回格式兼容（带后缀）
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

  const row = stmt.get(userId, cleanName);
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

  const rows = stmt.all(userId);

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

  const stmt = database.prepare(`
    DELETE FROM conversations WHERE user_id = ? AND name = ?
  `);

  const result = stmt.run(userId, cleanName);
  return result.changes > 0;
}

// --------------------------------------------------
// 关闭数据库（优雅退出）
// --------------------------------------------------
export function closeDatabase() {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}
