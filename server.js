// ============================================================
//  AI Chat CLI — Web 服务器
//  提供 REST API + SSE 流式代理 + 静态文件服务
// ============================================================

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

import { loadConfig, getSystemPrompt, PROVIDERS, generateConversationTitle } from './lib/config.js';
import {
  saveConversation,
  loadConversation as loadConv,
  listConversations,
  deleteConversation as deleteConv,
} from './lib/storage.js';
import { TOOLS, executeTool } from './lib/tools.js';
import {
  addDocument,
  searchKnowledge,
  getDocuments,
  deleteDocument,
  clearKnowledge,
  getKnowledgeStats,
} from './lib/rag.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(__dirname, 'public');

// 获取安全的临时目录（云环境兼容）
function getTempDir() {
  const projectTmp = join(__dirname, 'tmp');
  try {
    if (!existsSync(projectTmp)) mkdirSync(projectTmp, { recursive: true });
    const testFile = join(projectTmp, '.write-test');
    writeFileSync(testFile, 'ok');
    unlinkSync(testFile);
    return projectTmp;
  } catch {
    const sysTmp = join(tmpdir(), 'egg-chat-tmp');
    mkdirSync(sysTmp, { recursive: true });
    return sysTmp;
  }
}
const TMP_DIR = getTempDir();

// MIME 类型映射
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ============================================================
//  静态文件服务
// ============================================================
function serveStatic(res, urlPath) {
  let filePath = join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);

  // 防止路径穿越
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath)) {
    // SPA fallback: 非 API 路径全部返回 index.html
    if (!urlPath.startsWith('/api/')) {
      filePath = join(PUBLIC, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
  }

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}

// ============================================================
//  JSON 响应辅助
// ============================================================
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ============================================================
//  请求体解析
// ============================================================
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
  });
}

async function parseMultipart(req) {
  return new Promise((resolve) => {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(.+)/);
    if (!match) {
      console.log('[DEBUG] parseMultipart: 未找到 boundary');
      resolve({});
      return;
    }

    const boundary = match[1].replace(/^["']|["']$/g, '');
    const boundaryBuffer = Buffer.from(`--${boundary}\r\n`);
    const endBoundaryBuffer = Buffer.from(`--${boundary}--`);
    let body = Buffer.alloc(0);

    req.on('data', (chunk) => {
      body = Buffer.concat([body, chunk]);
    });

    req.on('end', () => {
      const result = {};
      
      if (body.length === 0) {
        console.log('[DEBUG] parseMultipart: body 为空');
        resolve(result);
        return;
      }

      const parts = [];
      let start = 0;
      
      while (start < body.length) {
        const boundaryIndex = body.indexOf(boundaryBuffer, start);
        if (boundaryIndex === -1) break;
        
        start = boundaryIndex + boundaryBuffer.length;
        
        const nextBoundaryIndex = body.indexOf(boundaryBuffer, start);
        const endIndex = body.indexOf(endBoundaryBuffer, start);
        
        let partEnd = -1;
        if (nextBoundaryIndex !== -1 && endIndex !== -1) {
          partEnd = Math.min(nextBoundaryIndex, endIndex);
        } else if (nextBoundaryIndex !== -1) {
          partEnd = nextBoundaryIndex;
        } else if (endIndex !== -1) {
          partEnd = endIndex;
        } else {
          partEnd = body.length;
        }
        
        if (partEnd > start) {
          parts.push(body.slice(start, partEnd));
        }
        
        start = partEnd;
      }

      console.log('[DEBUG] parseMultipart: 找到', parts.length, '个 parts');

      for (const partBuffer of parts) {
        const partStr = partBuffer.toString('utf-8');
        const headerEnd = partStr.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const headers = partStr.substring(0, headerEnd);
        const contentStart = headerEnd + 4;
        const contentBuffer = partBuffer.slice(contentStart);

        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);

        if (!nameMatch) continue;
        const name = nameMatch[1];

        console.log('[DEBUG] parseMultipart: 找到字段', name, filenameMatch ? '文件' : '普通字段');

        if (filenameMatch) {
          const filename = filenameMatch[1];
          const contentBase64 = contentBuffer.toString('base64');
          result[name] = { 
            filename, 
            content: contentBase64, 
            size: contentBuffer.length 
          };
        } else {
          result[name] = contentBuffer.toString('utf-8').replace(/\r\n$/, '');
        }
      }

      console.log('[DEBUG] parseMultipart: 结果', Object.keys(result));
      resolve(result);
    });
  });
}

// ============================================================
//  API 路由
// ============================================================

// POST /api/chat — 流式聊天 + Agent 工具调用 (SSE)
//
// Agent 循环:
//   1. 发送 messages + tools → AI
//   2. 解析流式响应，检测 content / tool_calls
//   3. 若 AI 调用工具 → 执行 → 结果塞回 messages → 回到步骤 1
//   4. 若 AI 输出文本 → 流式转发给浏览器 → 结束
//
// SSE 事件格式:
//   { content: "..." }          — 文本增量
//   { type: "tool_call", ... }  — AI 发起工具调用
//   { type: "tool_result", ... }— 工具执行结果
//   { done: true }              — 对话完成
//   { error: "..." }            — 错误
//
const UPLOADED_FILES = new Map();

async function handleFileUpload(config, req, res) {
  console.log('[DEBUG] 接收到文件上传请求');
  const contentType = req.headers['content-type'] || '';
  console.log('[DEBUG] Content-Type:', contentType);
  
  if (!contentType.startsWith('multipart/form-data')) {
    console.log('[DEBUG] 错误：Content-Type 不是 multipart/form-data');
    return json(res, 400, { error: '请使用 multipart/form-data 格式上传文件' });
  }

  const multipartData = await parseMultipart(req);
  console.log('[DEBUG] parseMultipart 结果:', JSON.stringify(Object.keys(multipartData)));
  
  if (!multipartData.file) {
    console.log('[DEBUG] 错误：未找到文件');
    return json(res, 400, { error: '未找到文件' });
  }

  const { filename, content, size } = multipartData.file;
  const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  
  UPLOADED_FILES.set(fileId, {
    id: fileId,
    filename,
    content,
    size,
    uploadedAt: Date.now(),
  });

  json(res, 200, { 
    success: true, 
    fileId, 
    filename, 
    size,
    message: '文件上传成功'
  });
}

function handleFileDelete(config, req, res, fileId) {
  if (UPLOADED_FILES.has(fileId)) {
    UPLOADED_FILES.delete(fileId);
    json(res, 200, { success: true, message: '文件已删除' });
  } else {
    json(res, 404, { error: '文件不存在' });
  }
}

async function handleChat(config, req, res) {
  let body;
  const contentType = req.headers['content-type'] || '';
  
  if (contentType.startsWith('multipart/form-data')) {
    const multipartData = await parseMultipart(req);
    body = {};
    if (multipartData.messages) {
      try {
        body.messages = JSON.parse(multipartData.messages);
      } catch {
        return json(res, 400, { error: 'messages 格式错误' });
      }
    }
    if (multipartData.file) {
      body.file = multipartData.file;
    }
  } else {
    body = await parseBody(req);
  }

  if (!body?.messages) {
    return json(res, 400, { error: '缺少 messages 字段' });
  }

  let uploadedFileContent = '';
  let uploadedFileName = '';
  
  let fileData = body.file;
  
  if (body.fileId && UPLOADED_FILES.has(body.fileId)) {
    const uploadedFile = UPLOADED_FILES.get(body.fileId);
    fileData = {
      filename: uploadedFile.filename,
      content: uploadedFile.content,
      size: uploadedFile.size
    };
  }
  
  if (fileData) {
    try {
      const buffer = Buffer.from(fileData.content, 'base64');
      const ext = fileData.filename.toLowerCase().split('.').pop();
      
      switch (ext) {
        case 'pdf': {
          const pdfParseModule = await import('pdf-parse');
          let pdfParse = pdfParseModule.default || pdfParseModule;
          if (typeof pdfParse !== 'function') {
            pdfParse = pdfParseModule.PDFParse ? (data) => {
              const parser = new pdfParseModule.PDFParse(data);
              return parser.getText();
            } : pdfParseModule;
          }
          const pdfData = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          const pdfResult = await pdfParse(pdfData);
          uploadedFileContent = typeof pdfResult === 'string' ? pdfResult : pdfResult.text;
          break;
        }
        case 'docx': {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ arrayBuffer: buffer });
          uploadedFileContent = result.value;
          break;
        }
        case 'xlsx':
        case 'xls': {
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          let text = '';
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            text += `\n=== 工作表: ${sheetName} ===\n`;
            text += XLSX.utils.sheet_to_csv(sheet);
          }
          uploadedFileContent = text;
          break;
        }
        case 'pptx': {
          const JSZip = await import('jszip');
          const zip = await JSZip.loadAsync(buffer);
          let text = '';
          const slideFiles = Object.keys(zip.files)
            .filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/))
            .sort((a, b) => {
              const numA = parseInt(a.match(/slide(\d+)/)[1]);
              const numB = parseInt(b.match(/slide(\d+)/)[1]);
              return numA - numB;
            });
          for (const slideFile of slideFiles) {
            const xml = await zip.file(slideFile).async('string');
            const slideNum = slideFile.match(/slide(\d+)/)[1];
            text += `\n=== 幻灯片 ${slideNum} ===\n`;
            const matches = xml.match(/<a:t>[^<]*<\/a:t>/g);
            if (matches) {
              text += matches.map(m => m.replace(/<[^>]*>/g, '')).join(' ') + '\n';
            }
          }
          uploadedFileContent = text;
          break;
        }
        case 'txt':
        case 'md':
        case 'json':
        case 'csv':
          uploadedFileContent = buffer.toString('utf-8');
          break;
        case 'html':
        case 'htm':
          uploadedFileContent = buffer.toString('utf-8').replace(/<[^>]*>/g, ' ');
          break;
        case 'doc':
        case 'ppt':
        default:
          uploadedFileContent = buffer.toString('utf-8');
      }
      uploadedFileName = fileData.filename;
    } catch (e) {
      return json(res, 400, { error: '文件解析失败: ' + e.message });
    }
  }

  // 复制消息数组（不污染请求原数据）
  let messages = structuredClone(body.messages);
  // 过滤掉前端自定义的角色（API 只支持 system/user/assistant/tool）
  messages = messages.filter(m => ['system', 'user', 'assistant', 'tool'].includes(m.role));

  // 获取用户最新的问题
  const userMessages = messages.filter(m => m.role === 'user');
  let latestQuestion = '';
  if (userMessages.length > 0) {
    const lastMsg = userMessages[userMessages.length - 1];
    if (Array.isArray(lastMsg.content)) {
      const textParts = lastMsg.content.filter(p => p.type === 'text');
      latestQuestion = textParts.map(p => p.text).join('');
    } else {
      latestQuestion = lastMsg.content;
    }
  }

  let ragContext = '';
  const stats = getKnowledgeStats();
  
  if (uploadedFileContent) {
    const fileSnippet = uploadedFileContent.slice(0, 3000);
    ragContext = `\n\n---\n用户上传了文件【${uploadedFileName}】，文件内容如下：\n${fileSnippet}\n${uploadedFileContent.length > 3000 ? '\n...（内容过长，仅显示前3000字符）\n' : ''}---\n`;
  } else if (stats.documentCount > 0) {
    const knowledgeResults = latestQuestion 
      ? await searchKnowledge(latestQuestion, config)
      : [];
    
    if (knowledgeResults.length > 0) {
      const contextSnippets = knowledgeResults.map((r, i) => 
        `[知识库片段 ${i + 1}] (相似度: ${(r.similarity * 100).toFixed(1)}%)\n${r.content}\n`
      ).join('\n');
      ragContext = `\n\n---\n基于以下知识库内容回答问题：\n${contextSnippets}\n---\n`;
    } else {
      const documents = getDocuments();
      if (documents.length > 0) {
        const docNames = documents.map(d => d.name).join(', ');
        ragContext = `\n\n---\n用户已上传以下文档，请主动提供分析服务：${docNames}\n---\n`;
      }
    }
  }

  // 构建系统提示词（包含 RAG 上下文）
  let systemPrompt = getSystemPrompt();
  if (ragContext) {
    systemPrompt += ragContext;
  }

  if (!messages[0] || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: systemPrompt });
  } else {
    messages[0].content = systemPrompt;
  }

  const model = body.model || config.model;
  const temperature = body.temperature ?? config.temperature;

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked',
  });

  function sseSend(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  }

  const MAX_TOOL_ROUNDS = 15;
  let totalContent = '';
  let usage = null;
  const searchHistory = [];  // 记录已搜索的关键词，避免重复搜索
  const MAX_SEARCH_ATTEMPTS = 3;  // 最多允许3次搜索，超过则强制回答

  try {
    // ─── Agent 循环 ───
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const requestBody = {
        model,
        messages,
        stream: true,
        temperature,
        max_tokens: config.maxTokens,
        tools: TOOLS,
        tool_choice: 'auto',
      };
      // Agent round: call AI with tools

      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.error?.message || `HTTP ${response.status}`;
        sseSend({ error: msg });
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let roundContent = '';
      let toolCalls = [];     // 累积的 tool_calls（按 index 合并）

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

            if (!delta) continue;

            // ── 文本：流式发送（本轮有 tool_calls 的话会作为思考过程被工具卡片顶掉）──
            if (delta.content) {
              roundContent += delta.content;
              totalContent += delta.content;
              sseSend({ content: delta.content });
            }

            // ── 工具调用：按 index 合并碎片 ──
            if (delta.tool_calls) {
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

      // ── 本轮结束：判断结果 ──
      // Round complete: check if toolCalls were made
      if (toolCalls.length > 0) {
        // ── AI 要求调用工具 ──

        // 添加 assistant 消息（含 tool_calls）
        messages.push({
          role: 'assistant',
          content: roundContent || null,
          tool_calls: toolCalls.filter((tc) => tc.id), // 只保留有 id 的
        });

        // 逐个执行工具
        for (const tc of toolCalls) {
          if (!tc.id) continue;

          const fnName = tc.function.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            fnArgs = {};
          }

          // ── 搜索历史检测 ──
          if (fnName === 'web_search' && fnArgs.query) {
            const query = fnArgs.query.trim().toLowerCase();
            
            // 检查是否与之前的搜索相似（简单关键词重叠检测）
            const isDuplicate = searchHistory.some(prev => {
              const prevWords = new Set(prev.toLowerCase().split(/\s+/));
              const currWords = query.split(/\s+/);
              let overlapCount = 0;
              for (const word of currWords) {
                if (prevWords.has(word) && word.length > 1) overlapCount++;
              }
              // 如果有60%以上的词重叠，认为是重复搜索
              return currWords.length > 0 && overlapCount / currWords.length > 0.6;
            });

            if (isDuplicate) {
              // 返回"已搜索过"的提示，不让AI继续浪费轮次
              sseSend({
                type: 'tool_call',
                tool_call_id: tc.id,
                name: fnName,
                arguments: fnArgs,
              });
              const toolResult = `这个搜索请求与之前的搜索过于相似，请基于已有的搜索结果回答问题，不要再重复搜索。`;
              sseSend({
                type: 'tool_result',
                tool_call_id: tc.id,
                name: fnName,
                result: toolResult,
              });
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: toolResult,
              });
              continue;
            }

            // 记录搜索历史
            searchHistory.push(query);
          }

          // 通知前端：开始调用工具
          sseSend({
            type: 'tool_call',
            tool_call_id: tc.id,
            name: fnName,
            arguments: fnArgs,
          });

          // 执行工具
          let toolResult;
          try {
            toolResult = await executeTool(fnName, fnArgs);
          } catch (err) {
            toolResult = `工具执行出错: ${err.message}`;
          }

          // 通知前端：工具返回结果
          sseSend({
            type: 'tool_result',
            tool_call_id: tc.id,
            name: fnName,
            result: toolResult,
          });

          // 添加 tool 消息到对话历史
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
        }

        // ── 强制回答检测：如果已搜索3次以上，添加提示让AI直接回答 ──
        const searchCount = searchHistory.length;
        if (searchCount >= MAX_SEARCH_ATTEMPTS) {
          messages.push({
            role: 'user',
            content: '请基于上面所有的搜索结果，直接回答用户的问题。不要再进行任何新的搜索，综合所有已有的信息给出完整的答案。',
          });
          // 重置搜索计数，只强制一次
          searchHistory.length = 0;
        }

        // 继续下一轮（AI 基于工具结果回答）
        continue;
      }

      // ── 纯文本回复 → 对话完成 ──
      sseSend({ done: true, usage });
      res.end();
      return;
    }

    // 达到最大轮次
    sseSend({ error: 'AI 思考时间过长，请尝试更具体的问题' });
    res.end();

  } catch (err) {
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

// GET /api/config — 获取当前配置信息（不暴露 API Key）
// GET /health — 健康检查
function handleHealthCheck(req, res) {
  json(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
}

function handleGetConfig(config, req, res) {
  json(res, 200, {
    provider: config.provider,
    providerName: config.providerName,
    model: config.model,
    availableModels: config.availableModels,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });
}

// PUT /api/config/model — 切换模型
async function handleSetModel(config, req, res) {
  const body = await parseBody(req);
  const model = body?.model;
  if (!model) return json(res, 400, { error: '缺少 model 字段' });
  if (!config.availableModels.includes(model)) {
    return json(res, 400, { error: `不支持模型: ${model}` });
  }
  config.model = model;
  json(res, 200, { success: true, model });
}

// GET /api/conversations — 列出已保存的对话
function handleListConversations(req, res) {
  const list = listConversations();
  json(res, 200, list);
}

// GET /api/conversations/:name — 加载对话
function handleLoadConversation(req, res, name) {
  const data = loadConv(name);
  if (!data) return json(res, 404, { error: '对话不存在' });
  json(res, 200, data);
}

// DELETE /api/conversations/:name — 删除对话
function handleDeleteConversation(req, res, name) {
  const ok = deleteConv(name);
  json(res, 200, { success: ok });
}

// POST /api/conversations — 保存对话
async function handleSaveConversation(config, req, res) {
  const body = await parseBody(req);
  if (!body?.messages) return json(res, 400, { error: '缺少 messages 字段' });

  let name = body.name || null;
  // 没有标题时，调用 AI 自动生成
  if (!name) {
    try {
      name = await generateConversationTitle(body.messages, config);
    } catch {}
  }

  const filename = saveConversation(name, body.messages);
  json(res, 200, { success: true, filename });
}

// ============================================================
//  RAG 知识库 API
// ============================================================

// GET /api/knowledge/stats — 获取知识库统计
function handleKnowledgeStats(req, res) {
  const stats = getKnowledgeStats();
  json(res, 200, stats);
}

// GET /api/knowledge/docs — 获取文档列表
function handleKnowledgeDocs(req, res) {
  const docs = getDocuments();
  json(res, 200, docs);
}

// POST /api/knowledge/upload — 上传文档
async function handleKnowledgeUpload(config, req, res) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return json(res, 400, { error: '需要 multipart/form-data 格式' });
  }

  let body = Buffer.from([]);
  for await (const chunk of req) {
    body = Buffer.concat([body, chunk]);
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) {
    return json(res, 400, { error: '未找到 boundary' });
  }

  const boundaryMarker = '--' + boundary;
  const bodyStr = body.toString('utf-8');
  const parts = bodyStr.split(boundaryMarker);
  let fileData = null;
  let fileName = '';

  for (const part of parts) {
    if (!part.includes('Content-Disposition')) continue;
    const nameMatch = part.match(/name="(.*?)"/);
    const filenameMatch = part.match(/filename="(.*?)"/);
    if (nameMatch?.[1] === 'file' && filenameMatch?.[1]) {
      fileName = filenameMatch[1];

      // 用字符串找头部结束位置（headers 是纯 ASCII，安全）
      const headerEndStr = '\r\n\r\n';
      const headerEndIdx = part.indexOf(headerEndStr);
      if (headerEndIdx === -1) continue;
      const partHeader = boundaryMarker + part.slice(0, headerEndIdx) + headerEndStr;

      // 在原始 Buffer 中定位文件内容的起止位置（避免 UTF-8 往返损坏二进制）
      const headerBuffer = Buffer.from(partHeader, 'utf-8');
      const contentStart = body.indexOf(headerBuffer);
      if (contentStart === -1) continue;

      const contentOffset = contentStart + headerBuffer.length;
      const closingMarker = Buffer.from('\r\n' + boundaryMarker, 'utf-8');
      let contentEnd = body.indexOf(closingMarker, contentOffset);
      if (contentEnd === -1) {
        contentEnd = body.length;
      }

      fileData = body.slice(contentOffset, contentEnd);
    }
  }

  if (!fileData || !fileName) {
    return json(res, 400, { error: '未找到文件' });
  }

  const tempPath = join(TMP_DIR, fileName);
  writeFileSync(tempPath, fileData);

  try {
    const result = await addDocument(tempPath, fileName, config);
    json(res, 200, { success: true, ...result });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
}

// DELETE /api/knowledge/docs/:id — 删除文档
function handleKnowledgeDelete(req, res, docId) {
  const result = deleteDocument(docId);
  json(res, 200, { success: true, ...result });
}

// DELETE /api/knowledge/clear — 清空知识库
function handleKnowledgeClear(req, res) {
  const result = clearKnowledge();
  json(res, 200, result);
}

// POST /api/knowledge/search — 搜索知识库
async function handleKnowledgeSearch(config, req, res) {
  const body = await parseBody(req);
  const query = body?.query;
  if (!query) return json(res, 400, { error: '缺少 query 字段' });

  const results = await searchKnowledge(query, config);
  json(res, 200, { results });
}

// ============================================================
//  路由分发
// ============================================================
function matchRoute(method, url) {
  // GET /health — 健康检查（部署必需）
  if (method === 'GET' && url === '/health') return { handler: 'health' };

  // GET /api/config
  if (method === 'GET' && url === '/api/config') return { handler: 'getConfig' };

  // PUT /api/config/model
  if (method === 'PUT' && url === '/api/config/model') return { handler: 'setModel' };

  // POST /api/chat
  if (method === 'POST' && url === '/api/chat') return { handler: 'chat' };

  // GET /api/conversations
  if (method === 'GET' && url === '/api/conversations') return { handler: 'listConversations' };

  // POST /api/conversations
  if (method === 'POST' && url === '/api/conversations') return { handler: 'saveConversation' };

  // GET /api/conversations/:name
  // DELETE /api/conversations/:name
  const convMatch = url.match(/^\/api\/conversations\/(.+)$/);
  if (convMatch) {
    const name = decodeURIComponent(convMatch[1]);
    if (method === 'GET') return { handler: 'loadConversation', name };
    if (method === 'DELETE') return { handler: 'deleteConversation', name };
  }

  // GET /api/knowledge/stats
  if (method === 'GET' && url === '/api/knowledge/stats') return { handler: 'knowledgeStats' };

  // GET /api/knowledge/docs
  if (method === 'GET' && url === '/api/knowledge/docs') return { handler: 'knowledgeDocs' };

  // POST /api/knowledge/upload
  if (method === 'POST' && url === '/api/knowledge/upload') return { handler: 'knowledgeUpload' };

  // DELETE /api/knowledge/clear
  if (method === 'DELETE' && url === '/api/knowledge/clear') return { handler: 'knowledgeClear' };

  // POST /api/knowledge/search
  if (method === 'POST' && url === '/api/knowledge/search') return { handler: 'knowledgeSearch' };

  // DELETE /api/knowledge/docs/:id
  const docMatch = url.match(/^\/api\/knowledge\/docs\/(.+)$/);
  if (docMatch && method === 'DELETE') {
    return { handler: 'knowledgeDelete', docId: decodeURIComponent(docMatch[1]) };
  }

  // POST /api/files/upload
  if (method === 'POST' && url === '/api/files/upload') return { handler: 'handleFileUpload' };

  // DELETE /api/files/:id
  const fileMatch = url.match(/^\/api\/files\/(.+)$/);
  if (fileMatch && method === 'DELETE') {
    return { handler: 'handleFileDelete', fileId: decodeURIComponent(fileMatch[1]) };
  }

  return null;
}

// ============================================================
//  启动服务器
// ============================================================
export function startServer(port = 3000) {
  const config = loadConfig();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`).pathname;
    const method = req.method;

    // 尝试匹配 API 路由
    const route = matchRoute(method, url);
    if (route) {
      switch (route.handler) {
        case 'health':
          return handleHealthCheck(req, res);
        case 'chat':
          return handleChat(config, req, res);
        case 'getConfig':
          return handleGetConfig(config, req, res);
        case 'setModel':
          return handleSetModel(config, req, res);
        case 'listConversations':
          return handleListConversations(req, res);
        case 'loadConversation':
          return handleLoadConversation(req, res, route.name);
        case 'deleteConversation':
          return handleDeleteConversation(req, res, route.name);
        case 'saveConversation':
          return handleSaveConversation(config, req, res);
        case 'knowledgeStats':
          return handleKnowledgeStats(req, res);
        case 'knowledgeDocs':
          return handleKnowledgeDocs(req, res);
        case 'knowledgeUpload':
          return handleKnowledgeUpload(config, req, res);
        case 'knowledgeDelete':
          return handleKnowledgeDelete(req, res, route.docId);
        case 'knowledgeClear':
          return handleKnowledgeClear(req, res);
        case 'knowledgeSearch':
          return handleKnowledgeSearch(config, req, res);
        case 'handleFileUpload':
          return handleFileUpload(config, req, res);
        case 'handleFileDelete':
          return handleFileDelete(config, req, res, route.fileId);
      }
    }

    // 静态文件
    serveStatic(res, url);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log('');
      console.log('  ╔═══════════════════════════════════════════╗');
      console.log('  ║  🤖 AI Chat Web v2.0                     ║');
      console.log('  ║                                           ║');
      console.log(`  ║  服务地址: http://localhost:${port}          ║`);
      console.log(`  ║  AI 平台: ${config.providerName.padEnd(31)}║`);
      console.log(`  ║  模型:    ${config.model.padEnd(31)}║`);
      console.log('  ╚═══════════════════════════════════════════╝');
      console.log('');
      console.log('  按 Ctrl+C 停止服务器');
      console.log('');
      resolve(server);
    });
  });
}

// 作为模块导出时，不自动启动；
// 直接运行时启动
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parseInt(process.env.PORT) || 3000;
  startServer(port);
}
