// ============================================
// 对话持久化模块（支持用户隔离）
// 保存 / 加载 / 列出历史对话
// 云环境自动使用 /tmp 目录
// ============================================

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// --------------------------------------------------
// 获取用户专属目录
// --------------------------------------------------
function getUserDir(userId) {
  const userDir = join(BASE_DIR, sanitizeFilename(userId));
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}

// --------------------------------------------------
// 生成安全的文件名（去除路径不安全的字符）
// --------------------------------------------------
function sanitizeFilename(name) {
  return (name || 'default').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
}

// --------------------------------------------------
// 保存对话
// @param {string|null} name — 对话名称，为 null 则自动生成
// @param {Array} messages — 消息数组
// @param {string} userId — 用户 ID（用于隔离）
// @returns {string} 保存的文件名
// --------------------------------------------------
export function saveConversation(name, messages, userId = 'default') {
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

// --------------------------------------------------
// 加载对话
// @param {string} name — 对话名称（可不带 .json 后缀）
// @param {string} userId — 用户 ID（用于隔离）
// @returns {Object|null} 对话数据，或 null
// --------------------------------------------------
export function loadConversation(name, userId = 'default') {
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

// --------------------------------------------------
// 列出所有已保存的对话
// @param {string} userId — 用户 ID（用于隔离）
// @returns {Array<{filename, name, savedAt, messageCount}>}
// --------------------------------------------------
export function listConversations(userId = 'default') {
  const userDir = getUserDir(userId);

  const files = readdirSync(userDir).filter((f) => f.endsWith('.json'));

  const results = [];
  for (const f of files) {
    const filepath = join(userDir, f);
    try {
      const content = readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);
      // 提取第一条用户消息作为对话预览标题
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

  // 按保存时间倒序
  results.sort((a, b) => {
    if (!a.savedAt) return 1;
    if (!b.savedAt) return -1;
    return b.savedAt.localeCompare(a.savedAt);
  });

  return results;
}

// --------------------------------------------------
// 删除指定对话
// @param {string} name — 对话名称
// @param {string} userId — 用户 ID（用于隔离）
// @returns {boolean} 是否删除成功
// --------------------------------------------------
export function deleteConversation(name, userId = 'default') {
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
