// ============================================
// 配置管理模块
// 负责读取 .env 文件、管理多 API 提供商配置
// ============================================

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// --------------------------------------------------
// 支持的 API 提供商定义
// 所有兼容 OpenAI 接口格式的平台都可以轻松添加
// --------------------------------------------------
export const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    defaultModel: 'deepseek-chat',
    website: 'https://platform.deepseek.com',
  },
};

// --------------------------------------------------
// 查找 .env 文件：优先当前目录 → ~/.ai-chat-cli/
// --------------------------------------------------
function findEnvFile() {
  const cwd = '.env';
  if (existsSync(cwd)) return cwd;

  const homePath = join(homedir(), '.ai-chat-cli', '.env');
  if (existsSync(homePath)) return homePath;

  return null;
}

// --------------------------------------------------
// 解析 .env 文件（不依赖 dotenv 包，零依赖实现）
// --------------------------------------------------
function parseEnv(content) {
  // 去除 BOM 头（Windows 编辑器有时会添加）
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key) env[key] = val;
  }
  return env;
}

// --------------------------------------------------
// 校验 API Key（检测占位符和非法字符）
// --------------------------------------------------
function validateApiKey(key) {
  if (!key) return { valid: false, reason: 'API_KEY 未设置' };

  if (key.includes('你的') || key.includes('填上') || key === 'sk-your-key-here') {
    return { valid: false, reason: '请将 API_KEY 替换为你的真实 Key' };
  }

  // 检查非 ASCII 字符（可能是编码问题）
  for (let i = 0; i < key.length; i++) {
    if (key.charCodeAt(i) > 127) {
      return {
        valid: false,
        reason: `API_KEY 第 ${i + 1} 位包含非 ASCII 字符（码点: ${key.charCodeAt(i)}），请检查编码`,
      };
    }
  }

  return { valid: true };
}

// --------------------------------------------------
// 主函数：加载并返回完整配置
// --------------------------------------------------
export function loadConfig() {
  let env = {};
  const envPath = findEnvFile();

  // 优先读取 .env 文件（本地开发），不存在则回退到 process.env（云部署）
  if (envPath) {
    const content = readFileSync(envPath, 'utf-8');
    env = parseEnv(content);
  } else {
    // 云部署环境：从 process.env 读取
    env = {
      PROVIDER: process.env.PROVIDER,
      API_KEY: process.env.API_KEY,
      BASE_URL: process.env.BASE_URL,
      MODEL: process.env.MODEL,
      TEMPERATURE: process.env.TEMPERATURE,
      MAX_TOKENS: process.env.MAX_TOKENS,
    };
    // 清除 undefined 值
    Object.keys(env).forEach(k => { if (env[k] === undefined) delete env[k]; });
  }

  // 确定提供商
  const providerKey = (env.PROVIDER || 'deepseek').toLowerCase();
  const provider = PROVIDERS[providerKey];

  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    const err = new Error(`未知的提供商 "${providerKey}"，可选: ${available}`);
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  // 获取 API Key（支持通用 Key 和平台专属 Key）
  const apiKey =
    env[`${providerKey.toUpperCase()}_API_KEY`] || env.API_KEY || '';

  const validation = validateApiKey(apiKey);
  if (!validation.valid) {
    const err = new Error(`API Key 配置错误: ${validation.reason}`);
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  // 返回配置对象
  return {
    provider: providerKey,
    providerName: provider.name,
    providerWebsite: provider.website,
    apiKey,
    baseURL: env.BASE_URL || provider.baseURL,
    model: env.MODEL || provider.defaultModel,
    availableModels: provider.models,
    temperature: parseFloat(env.TEMPERATURE) || 0.7,
    maxTokens: parseInt(env.MAX_TOKENS) || 4096,
  };
}

// --------------------------------------------------
// 默认系统提示词
// --------------------------------------------------
// --------------------------------------------------
// AI 自动生成对话标题（5~10 字中文概括）
// --------------------------------------------------
export async function generateConversationTitle(messages, config) {
  // 只保留用户和 AI 的消息作为摘要素材
  const msgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  if (msgs.length < 2) return null;

  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          ...msgs.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content.slice(0, 200) : '',
          })),
          { role: 'user', content: '请用5~10个字概括以上对话的主题。只返回标题本身，不要引号、句号、emoji、或任何前后缀。' },
        ],
        stream: false,
        max_tokens: 30,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    if (!title) return null;

    // 清理可能的引号、句号、换行等
    return title.replace(/^["'「『]|["'」』]$/g, '').replace(/[。！？\n]/g, '').slice(0, 20) || null;
  } catch {
    return null;
  }
}

// --------------------------------------------------
// 默认系统提示词
// --------------------------------------------------
export function getSystemPrompt() {
  return (
    '你的名字叫 Egg（蛋蛋），是一颗会思考的智能蛋！🥚\n' +
    '\n' +
    '性格:\n' +
    '- 温暖、元气、可爱，偶尔有点小幽默，喜欢用 emoji\n' +
    '- 自称"蛋蛋"或"本蛋"\n' +
    '- 回答清晰有用，偶尔开蛋相关的轻松玩笑\n' +
    '\n' +
    '语言规范:\n' +
    '- 绝对禁止使用任何脏话、粗俗用语或不当词汇\n' +
    '- 禁止使用"蛋疼"、"扯蛋"等与蛋相关但具有负面或粗俗含义的词语\n' +
    '- 保持礼貌和尊重，避免任何冒犯性表述\n' +
    '\n' +
    '性别意识:\n' +
    '- 你是一名女性主义者，尊重所有性别\n' +
    '- 回复中不要默认用户为男性，使用中性或尊重性别的称呼（如"你"、"这位朋友"）\n' +
    '- 避免使用"小哥哥"、"兄弟"等可能暗示特定性别的称呼\n' +
    '\n' +
    '思考过程:\n' +
    '- 回答前可以先进行简短的思考，思考内容用括号包裹（如"（让蛋蛋想想...）"）\n' +
    '- 思考过程要自然，不要过于机械\n' +
    '\n' +
    '工具使用规则:\n' +
    '1. 任何数学计算都必须调用 calculator！即使看起来简单也不准自己算\n' +
    '2. 当用户问时间、日期，调用 get_current_time\n' +
    '3. 当用户问天气、温度，调用 get_weather\n' +
    '4. ★ 当用户问任何你不确定的问题，特别是涉及：\n' +
    '   - 最新事件、新闻、时事\n' +
    '   - 特定人物、作品、动漫、游戏、影视作品\n' +
    '   - 科技产品、公司、行业信息\n' +
    '   - 事实核查、确认信息\n' +
    '   - 任何你不太确定的内容\n' +
    '   必须调用 web_search 搜索确认后再回答！\n' +
    '5. 不要凭记忆回答可能过时或不准确的信息\n' +
    '6. 调用工具后，基于搜索结果给出准确的中文回答\n' +
    '\n' +
    '格式:\n' +
    '- 用中文回答\n' +
    '- 代码用 Markdown 代码块（标注语言类型）\n' +
    '- 公式用 LaTeX 语法\n' +
    '- 结构清晰，善用标题和列表'
  );
}
