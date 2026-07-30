// ============================================
// 对话持久化模块（支持用户隔离）
// 保存 / 加载 / 列出历史对话
// 优先使用 SQLite，失败则回退到文件存储
// ============================================

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 尝试加载 SQLite 数据库模块 ──
let dbAvailable = false;
let dbModule = null;

try {
  dbModule = await import('./db.js');
  dbModule.initDatabase();
  dbAvailable = true;
} catch (e) {
  // SQLite 不可用（编译失败 / 云环境限制 / 磁盘问题），回退到文件存储
  dbAvailable = false;
}

// ── 文件存储底层（作为 fallback）──

// 选择数据目录：优先使用项目内的 data 目录，失败则回退到系统 tmp
function getDataDir() {
  const projectDataDir = join(__dirname, '..', 'data', 'conversations');
  try {
    if (!existsSync(projectDataDir)) {
      mkdirSync(projectDataDir, { recursive: true });
    }
    // 测试写入权限
    const testFile = join(projectDataDir, '.write-test');
    writeFileSync(testFile, 'ok');
    unlinkSync(testFile);
    return projectDataDir;
  } catch {
    // 云环境可能无法写入项目目录，使用系统 tmp
    const tmpDataDir = join(tmpdir(), 'egg-chat-conversations');
    mkdirSync(tmpDataDir, { recursive: true });
    return tmpDataDir;
  }
}

const BASE_DIR = getDataDir();

// 获取用户专属目录
function getUserDir(userId) {
  const userDir = join(BASE_DIR, sanitizeFilename(userId));
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}

// 生成安全的文件名（去除路径不安全的字符）
function sanitizeFilename(name) {
  return (name || 'default').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
}

// 文件存储：保存
function saveConversationFile(name, messages, userId) {
  const userDir = getUserDir(userId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = name
    ? `${sanitizeFilename(name)}.json`
    : `chat-${timestamp}.json`;

  const filepath = join(userDir, filename);

  const data = {
    version: '2.0',
    savedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages,
  };

  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  return filename;
}

// 文件存储：加载
function loadConversationFile(name, userId) {
  const userDir = getUserDir(userId);

  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const filepath = join(userDir, filename);

  if (!existsSync(filepath)) return null;

  try {
    const content = readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// 文件存储：列出
function listConversationsFile(userId) {
  const userDir = getUserDir(userId);

  if (!existsSync(userDir)) return [];

  const files = readdirSync(userDir).filter((f) => f.endsWith('.json'));

  const results = [];
  for (const f of files) {
    const filepath = join(userDir, f);
    try {
      const content = readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);
      const firstUserMsg = data.messages?.find(m => m.role === 'user');
      let preview = '';
      if (firstUserMsg) {
        const text = typeof firstUserMsg.content === 'string'
          ? firstUserMsg.content
          : firstUserMsg.content?.map(p => p.text || '').join('') || '';
        preview = text.slice(0, 30);
      }
      results.push({
        filename: f,
        name: basename(f, '.json'),
        savedAt: data.savedAt || null,
        messageCount: data.messageCount || data.messages?.length || 0,
        preview: preview || '未命名对话',
      });
    } catch {
      results.push({
        filename: f,
        name: basename(f, '.json'),
        savedAt: null,
        messageCount: 0,
        preview: '未命名对话',
      });
    }
  }

  results.sort((a, b) => {
    if (!a.savedAt) return 1;
    if (!b.savedAt) return -1;
    return b.savedAt.localeCompare(a.savedAt);
  });

  return results;
}

// 文件存储：删除
function deleteConversationFile(name, userId) {
  const userDir = getUserDir(userId);

  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const filepath = join(userDir, filename);

  if (!existsSync(filepath)) return false;

  try {
    unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}

// ── 适配层：优先 SQLite，失败回退文件 ──

export function saveConversation(name, messages, userId = 'default') {
  if (dbAvailable) {
    try {
      return dbModule.saveConversationDB(name, messages, userId);
    } catch {
      // DB 写入失败，回退文件
    }
  }
  return saveConversationFile(name, messages, userId);
}

export function loadConversation(name, userId = 'default') {
  if (dbAvailable) {
    try {
      return dbModule.loadConversationDB(name, userId);
    } catch {
      // DB 读取失败，回退文件
    }
  }
  return loadConversationFile(name, userId);
}

export function listConversations(userId = 'default') {
  if (dbAvailable) {
    try {
      return dbModule.listConversationsDB(userId);
    } catch {
      // DB 读取失败，回退文件
    }
  }
  return listConversationsFile(userId);
}

export function deleteConversation(name, userId = 'default') {
  if (dbAvailable) {
    try {
      const dbResult = dbModule.deleteConversationDB(name, userId);
      // 同时删除可能存在的旧文件数据
      deleteConversationFile(name, userId);
      return dbResult;
    } catch {}
  }
  return deleteConversationFile(name, userId);
}

// ── 旧数据自动迁移：首次启动时将 JSON 文件迁移到 SQLite ──
let _migrationDone = false;

export function ensureMigration(userId = 'default') {
  if (!dbAvailable || _migrationDone) return;
  _migrationDone = true;

  try {
    const fileList = listConversationsFile(userId);
    let migrated = 0;
    for (const conv of fileList) {
      const data = loadConversationFile(conv.name, userId);
      if (data?.messages) {
        try {
          dbModule.saveConversationDB(conv.name, data.messages, userId);
          migrated++;
        } catch {}
      }
    }
    if (migrated > 0) {
      console.log(`[storage] 已将 ${migrated} 个对话从文件迁移到 SQLite`);
    }
  } catch {}
}

// 文件重命名（用于 rename API；DB 模式不需要此操作，由 save+delete 实现）
export { renameSync as _renameFile };
