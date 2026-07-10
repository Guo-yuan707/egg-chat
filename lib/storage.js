// ============================================
// 对话持久化模块
// 保存 / 加载 / 列出历史对话
// 数据存储在 ~/.ai-chat-cli/conversations/
// ============================================

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';

// 数据存储目录
const DATA_DIR = join(homedir(), '.ai-chat-cli', 'conversations');

// --------------------------------------------------
// 确保数据目录存在
// --------------------------------------------------
function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// --------------------------------------------------
// 生成安全的文件名（去除路径不安全的字符）
// --------------------------------------------------
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
}

// --------------------------------------------------
// 保存对话
// @param {string|null} name — 对话名称，为 null 则自动生成
// @param {Array} messages — 消息数组
// @returns {string} 保存的文件名
// --------------------------------------------------
export function saveConversation(name, messages) {
  ensureDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = name
    ? `${sanitizeFilename(name)}.json`
    : `chat-${timestamp}.json`;

  const filepath = join(DATA_DIR, filename);

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
// @returns {Object|null} 对话数据，或 null
// --------------------------------------------------
export function loadConversation(name) {
  ensureDir();

  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const filepath = join(DATA_DIR, filename);

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
// @returns {Array<{filename, name, savedAt, messageCount}>}
// --------------------------------------------------
export function listConversations() {
  ensureDir();

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));

  const results = [];
  for (const f of files) {
    const filepath = join(DATA_DIR, f);
    try {
      const content = readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);
      results.push({
        filename: f,
        name: basename(f, '.json'),
        savedAt: data.savedAt || null,
        messageCount: data.messageCount || data.messages?.length || 0,
      });
    } catch {
      results.push({
        filename: f,
        name: basename(f, '.json'),
        savedAt: null,
        messageCount: 0,
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
// @returns {boolean} 是否删除成功
// --------------------------------------------------
export function deleteConversation(name) {
  ensureDir();

  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const filepath = join(DATA_DIR, filename);

  if (!existsSync(filepath)) return false;

  try {
    unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}
