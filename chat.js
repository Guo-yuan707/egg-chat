#!/usr/bin/env node
// ============================================================
//  AI Chat CLI v2.0 — 智能命令行聊天机器人
//
//  核心特性:
//    ✓ 流式输出 — SSE 逐字显示 AI 回复
//    ✓ Agent 工具调用 — 计算器 / 时间 / 搜索 / 天气
//    ✓ 多平台 — DeepSeek OpenAI-compatible API
//    ✓ Markdown — 代码高亮、粗体、列表、引用
//    ✓ 持久化 — 保存 / 加载历史对话
//    ✓ Token 统计 — 实时显示用量
//    ✓ 优雅的错误处理 — 超时重试、中断恢复
//
//  技术栈: Node.js 20+ (原生 fetch + Web Streams)
//  协议: OpenAI-compatible Chat Completions API
// ============================================================

import { createInterface } from 'readline';
import chalk from 'chalk';
import ora from 'ora';

import { loadConfig, getSystemPrompt, PROVIDERS, generateConversationTitle } from './lib/config.js';
import {
  welcome,
  success,
  error as showError,
  info,
  warn,
  dim,
  hr,
  showHelp,
  showUsage,
} from './lib/ui.js';
import {
  saveConversation,
  loadConversation,
  listConversations,
} from './lib/storage.js';
import { TOOLS, executeTool } from './lib/tools.js';

// ============================================================
//  全局状态
// ============================================================

let config = loadConfig();
let messages = [{ role: 'system', content: getSystemPrompt() }];
let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
let isStreaming = false;      // 是否正在接收 AI 回复
let abortController = null;   // 用于中断当前请求
let conversationName = null;  // 当前对话名称（用于保存）

// ============================================================
//  核心函数：流式调用 AI API
//
//  使用 Server-Sent Events (SSE) 协议接收逐 token 回复。
//  Node.js 原生 fetch 返回的 ReadableStream 逐块读取，
//  解析 "data: {...}" 行提取内容 delta。
// ============================================================

async function streamChat() {
  isStreaming = true;
  abortController = new AbortController();

  const MAX_TOOL_ROUNDS = 5;
  let totalContent = '';
  let usage = null;

  try {
    // ─── Agent 循环 ───
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const spinner = ora({
        text: round === 0 ? chalk.dim('AI 思考中...') : chalk.dim('AI 基于工具结果思考中...'),
        color: 'cyan',
        spinner: 'dots',
      }).start();

      let roundContent = '';
      let toolCalls = [];
      let firstToken = true;
      let retries = 0;
      const maxRetries = 2;

      // 单次 API 调用（含重试）
      while (retries <= maxRetries) {
        try {
          const response = await fetch(`${config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages,
              stream: true,
              temperature: config.temperature,
              max_tokens: config.maxTokens,
              tools: TOOLS,
              tool_choice: 'auto',
            }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            spinner.stop();
            let errorMsg = `HTTP ${response.status}`;
            try {
              const errData = await response.json();
              errorMsg = errData.error?.message || errData.message || errorMsg;
            } catch {}
            showError(`API 调用失败: ${errorMsg}`);

            if (response.status >= 400 && response.status < 500) {
              isStreaming = false;
              return null;
            }
            retries++;
            if (retries <= maxRetries) {
              spinner.text = chalk.dim(`重试中 (${retries}/${maxRetries})...`);
              spinner.start();
              await sleep(1000 * retries);
              continue;
            }
            isStreaming = false;
            return null;
          }

          // ─── 读取 SSE 流 ───
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;

              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                // 收到第一个 token 时停止加载动画
                if (delta?.content) {
                  if (firstToken) {
                    spinner.stop();
                    firstToken = false;
                  }
                  roundContent += delta.content;
                  process.stdout.write(delta.content);
                }

                // ── 工具调用：按 index 合并碎片 ──
                if (delta?.tool_calls) {
                  // 工具调用开始前停止 spinner
                  if (firstToken) {
                    spinner.stop();
                    firstToken = false;
                  }
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? toolCalls.length;
                    while (toolCalls.length <= idx) {
                      toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
                    }
                    if (tc.id) toolCalls[idx].id = tc.id;
                    if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
                    if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                  }
                }

                if (parsed.usage) usage = parsed.usage;
              } catch {}
            }
          }

          // 处理缓冲区中可能残留的最后一行
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data:') && trimmed.slice(5).trim() !== '[DONE]') {
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim());
                if (parsed.usage) usage = parsed.usage;
              } catch {}
            }
          }

          if (firstToken) spinner.stop();
          break; // 成功，跳出重试循环

        } catch (err) {
          spinner.stop();

          // 用户主动中断（Ctrl+C）
          if (err.name === 'AbortError') {
            if (roundContent || totalContent) {
              console.log('');
              dim('  ⏸️  已中断 (部分回复已保留在对话历史中)');
              isStreaming = false;
              return roundContent || totalContent;
            }
            dim('  ⏸️  已中断');
            isStreaming = false;
            return null;
          }

          // 网络错误，尝试重试
          if (retries < maxRetries) {
            retries++;
            spinner.text = chalk.dim(`网络错误，重试中 (${retries}/${maxRetries})...`);
            spinner.start();
            await sleep(1000 * retries);
            continue;
          }

          showError(`网络请求失败: ${err.message}`);
          isStreaming = false;
          return null;
        }
      }

      // ─── 本轮结束：判断是否有工具调用 ───
      if (toolCalls.length > 0) {
        // AI 要求调用工具
        messages.push({
          role: 'assistant',
          content: roundContent || null,
          tool_calls: toolCalls.filter(tc => tc.id),
        });

        // 逐个执行工具
        for (const tc of toolCalls) {
          if (!tc.id) continue;

          const fnName = tc.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}

          console.log('');
          info(`🔧 调用工具: ${fnName}`);
          dim(`   参数: ${JSON.stringify(fnArgs)}`);

          try {
            const result = await executeTool(fnName, fnArgs);
            const short = result.length > 200 ? result.slice(0, 200) + '...' : result;
            dim(`   结果: ${short}`);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          } catch (err) {
            showError(`工具执行失败: ${err.message}`);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `工具执行出错: ${err.message}` });
          }
        }

        console.log('');
        continue; // 下一轮
      }

      // ─── 纯文本回复 → 对话完成 ───
      totalContent = roundContent;

      if (usage) {
        totalUsage.prompt_tokens += usage.prompt_tokens || 0;
        totalUsage.completion_tokens += usage.completion_tokens || 0;
        totalUsage.total_tokens += usage.total_tokens || 0;
        showUsage(usage);
      }

      console.log('');
      isStreaming = false;
      return totalContent || '(空回复)';
    }

    // 达到最大轮次
    warn('达到最大工具调用轮次，请简化问题重试');
    isStreaming = false;
    return totalContent || '(空回复)';

  } finally {
    isStreaming = false;
  }
}

// 工具：延迟
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
//  命令系统
//
//  每个命令包含:
//    desc  — 简短描述
//    usage — 使用示例（可选）
//    handler(args) — 命令执行函数
// ============================================================

const commands = {
  '/exit': {
    desc: '退出程序（自动保存对话）',
    handler: async () => {
      if (messages.length > 1) {
        let name = null;
        try { name = await generateConversationTitle(messages, config); } catch {}
        const filename = saveConversation(name, messages);
        info(`对话已自动保存至: ${filename}`);
      }
      console.log(chalk.dim('  👋 再见！'));
      process.exit(0);
    },
  },

  '/clear': {
    desc: '清空当前对话历史',
    handler: () => {
      messages = [{ role: 'system', content: getSystemPrompt() }];
      totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      conversationName = null;
      success('对话已清空');
    },
  },

  '/save': {
    desc: '保存当前对话到本地（自动生成标题）',
    usage: '/save [名称]',
    handler: async (args) => {
      if (messages.length <= 1) {
        warn('当前对话为空，无需保存');
        return;
      }
      let name = args.trim() || conversationName || null;
      // 没有指定名称时，调用 AI 自动生成标题
      if (!name) {
        info('AI 正在生成对话标题...');
        try {
          name = await generateConversationTitle(messages, config);
        } catch {}
      }
      const filename = saveConversation(name, messages);
      conversationName = name || filename.replace('.json', '');
      success(`已保存为 "${filename}" (${messages.length} 条消息)`);
      dim(`  存储位置: ~/.ai-chat-cli/conversations/${filename}`);
    },
  },

  '/load': {
    desc: '从本地加载历史对话',
    usage: '/load <名称>',
    handler: (args) => {
      const name = args.trim();
      if (!name) {
        warn('请指定对话名称。使用 /list 查看可加载的对话');
        return;
      }
      const data = loadConversation(name);
      if (!data) {
        showError(`未找到对话 "${name}"。使用 /list 查看所有对话`);
        return;
      }
      // 合并消息：保留系统提示词 + 加载的消息
      const systemMsg = messages[0];
      messages = data.messages;
      // 确保有系统提示词
      if (!messages[0] || messages[0].role !== 'system') {
        messages.unshift(systemMsg);
      }
      totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      conversationName = name;
      success(`已加载 "${name}" (${data.messageCount} 条消息)`);
    },
  },

  '/list': {
    desc: '列出所有已保存的对话',
    handler: () => {
      const list = listConversations();
      if (list.length === 0) {
        dim('  (暂无已保存的对话)');
        return;
      }
      console.log('');
      console.log(chalk.bold('  📁 已保存的对话:'));
      console.log('');
      for (const c of list) {
        const date = c.savedAt
          ? new Date(c.savedAt).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '时间未知';
        const count = `${c.messageCount} 条消息`;
        console.log(
          `    ${chalk.cyan(c.name.padEnd(25))} ${chalk.dim(count.padEnd(12) + date)}`
        );
      }
      console.log('');
      dim(`  存储位置: ~/.ai-chat-cli/conversations/`);
      console.log('');
    },
  },

  '/models': {
    desc: '查看当前平台可用的模型',
    handler: () => {
      console.log('');
      console.log(`  当前平台: ${chalk.bold(config.providerName)}`);
      console.log(`  接口地址: ${chalk.dim(config.baseURL)}`);
      console.log('');
      for (const m of config.availableModels) {
        const marker = m === config.model ? chalk.green(' ▶ ') : '   ';
        console.log(`  ${marker}${m}`);
      }
      console.log('');
      dim('  切换模型: /model <模型名>');
      console.log('');
    },
  },

  '/model': {
    desc: '切换 AI 模型',
    usage: '/model <模型名>',
    handler: (args) => {
      const name = args.trim();
      if (!name) {
        warn('请指定模型名。使用 /models 查看可用模型');
        return;
      }
      if (!config.availableModels.includes(name)) {
        showError(`当前平台无此模型: "${name}"`);
        info(`可用模型: ${config.availableModels.join(', ')}`);
        return;
      }
      config.model = name;
      success(`已切换至: ${name}`);
    },
  },

  '/system': {
    desc: '查看或修改系统提示词',
    usage: '/system [新的提示词]',
    handler: (args) => {
      if (!args.trim()) {
        // 无参数 → 查看当前提示词
        console.log('');
        console.log(chalk.bold('  📝 当前系统提示词:'));
        console.log(chalk.dim(`  "${messages[0].content.slice(0, 200)}${messages[0].content.length > 200 ? '...' : ''}"`));
        console.log('');
        return;
      }
      messages[0] = { role: 'system', content: args.trim() };
      success('系统提示词已更新');
    },
  },

  '/stats': {
    desc: '查看本次对话的 Token 统计',
    handler: () => {
      console.log('');
      console.log(chalk.bold('  📊 本次对话统计'));
      console.log('');
      const userMsgs = messages.filter((m) => m.role === 'user').length;
      const aiMsgs = messages.filter((m) => m.role === 'assistant').length;
      console.log(`  用户消息: ${chalk.cyan(userMsgs)} 条`);
      console.log(`  AI 回复:  ${chalk.cyan(aiMsgs)} 条`);
      console.log(`  输入 Token: ${chalk.yellow(totalUsage.prompt_tokens.toLocaleString())}`);
      console.log(`  输出 Token: ${chalk.yellow(totalUsage.completion_tokens.toLocaleString())}`);
      console.log(`  总计 Token: ${chalk.bold(totalUsage.total_tokens.toLocaleString())}`);
      console.log(`  当前模型:   ${chalk.dim(config.model)} @ ${config.providerName}`);
      console.log('');
    },
  },

  '/help': {
    desc: '显示帮助信息',
    handler: () => showHelp(),
  },
};

// --------------------------------------------------
// 判断用户输入是否为命令
// --------------------------------------------------
function isCommand(input) {
  return input.startsWith('/');
}

// --------------------------------------------------
// 执行命令，返回是否应继续对话循环
// --------------------------------------------------
async function handleCommand(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1).join(' ');

  const command = commands[cmd];
  if (!command) {
    warn(`未知命令 "${cmd}"。输入 /help 查看可用命令`);
    return true;
  }

  console.log('');
  await command.handler(args);
  console.log('');

  return cmd !== '/exit';
}

// ============================================================
//  主程序入口
// ============================================================

async function main() {
  // 显示欢迎横幅
  welcome(config);

  // 创建 readline 接口
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // ─── 处理 Ctrl+C ───
  // 第一次 Ctrl+C: 中断当前 AI 请求
  // 第二次 Ctrl+C: 保存并退出
  let sigintCount = 0;

  process.on('SIGINT', () => {
    if (isStreaming && abortController) {
      // 正在接收 AI 回复 → 中断请求
      abortController.abort();
      sigintCount = 0;
      return;
    }

    // 没有进行中的请求 → 退出
    sigintCount++;

    if (sigintCount === 1) {
      console.log('');
      console.log(chalk.dim('  再按一次 Ctrl+C 退出...'));
      // 1 秒后重置计数
      setTimeout(() => { sigintCount = 0; }, 1000);
      return;
    }

    // 第二次 Ctrl+C → 立即退出
    console.log('');
    if (messages.length > 1) {
      const filename = saveConversation(null, messages);
      console.log(chalk.dim(`  💾 已自动保存: ${filename}`));
    }
    console.log(chalk.dim('  👋 再见！'));
    process.exit(0);
  });

  // 标记 readline 是否已关闭（管道输入 EOF 时会关闭）
  let rlClosed = false;

  rl.on('close', async () => {
    rlClosed = true;
    // 非命令触发的关闭（如 EOF）→ 自动保存
    if (messages.length > 1) {
      let name = null;
      try { name = await generateConversationTitle(messages, config); } catch {}
      const filename = saveConversation(name, messages);
      console.log(chalk.dim(`  💾 已自动保存: ${filename}`));
    }
  });

  // ─── 对话循环 ───
  const askQuestion = () => {
    if (rlClosed) return;

    rl.question(chalk.green('🧑 你: '), async (userInput) => {
      if (rlClosed) return;

      // 处理命令
      if (isCommand(userInput)) {
        const shouldContinue = await handleCommand(userInput);
        if (!shouldContinue) {
          rl.close();
          return;
        }
        if (!rlClosed) askQuestion();
        return;
      }

      // 忽略空输入
      if (!userInput.trim()) {
        if (!rlClosed) askQuestion();
        return;
      }

      // 将用户消息加入历史
      messages.push({ role: 'user', content: userInput });

      // 调用 AI（流式输出）
      process.stdout.write(chalk.cyan('🤖 AI: '));
      const reply = await streamChat();

      if (reply) {
        // 将 AI 回复加入历史（多轮对话的关键）
        messages.push({ role: 'assistant', content: reply });
      } else if (!isStreaming) {
        // 未收到回复且非中断 → 显示提示并回滚用户消息
        messages.pop();
        dim('  (未收到回复，请重试)');
      }

      if (!rlClosed) askQuestion();
    });
  };

  askQuestion();
}

// ============================================================
//  启动
// ============================================================

main().catch((err) => {
  console.error(chalk.red('程序异常:'), err.message);
  process.exit(1);
});
