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
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    website: 'https://platform.openai.com',
  },
  zhipu: {
    name: '智谱 AI',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4', 'glm-4-plus'],
    defaultModel: 'glm-4-flash',
    website: 'https://open.bigmodel.cn',
  },
  qwen: {
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    defaultModel: 'qwen-turbo',
    website: 'https://dashscope.aliyun.com',
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
  const envPath = findEnvFile();

  if (!envPath) {
    console.error('');
    console.error('  ❌ 未找到 .env 配置文件');
    console.error('');
    console.error('  快速开始:');
    console.error('    1. 复制 .env.example → .env');
    console.error('    2. 填入你的 API Key');
    console.error('    3. 重新运行 npm start');
    console.error('');
    console.error('  支持的平台:');
    for (const [key, p] of Object.entries(PROVIDERS)) {
      console.error(`    • ${p.name} — ${p.website}`);
    }
    console.error('');
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf-8');
  const env = parseEnv(content);

  // 确定提供商
  const providerKey = (env.PROVIDER || 'deepseek').toLowerCase();
  const provider = PROVIDERS[providerKey];

  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    console.error(`❌ 未知的提供商 "${providerKey}"，可选: ${available}`);
    process.exit(1);
  }

  // 获取 API Key（支持通用 Key 和平台专属 Key）
  const apiKey =
    env[`${providerKey.toUpperCase()}_API_KEY`] || env.API_KEY || '';

  const validation = validateApiKey(apiKey);
  if (!validation.valid) {
    console.error(`❌ ${validation.reason}`);
    process.exit(1);
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
    '3. 当用户要求搜索、查最新信息，调用 web_search\n' +
    '4. 调用工具后，基于结果给出清晰的中文回答\n' +
    '\n' +
    '格式:\n' +
    '- 用中文回答\n' +
    '- 代码用 Markdown 代码块（标注语言类型）\n' +
    '- 公式用 LaTeX 语法\n' +
    '- 结构清晰，善用标题和列表'
  );
}
