# 🥚 Egg AI Chat

> 一颗会思考的智能蛋！🌱 功能完备的 AI 聊天应用 — **Web 界面** + **命令行** 双模式，支持多平台、SSE 流式输出、RAG 知识库、联网搜索、Markdown 渲染、对话持久化。

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 📸 两种运行模式

| 模式 | 启动命令 | 体验 |
|------|----------|------|
| **Web 界面** 🖥️ | `npm start` | 浏览器打开 → ChatGPT 风格 UI |
| **命令行** 💻 | `npm run chat` | 终端里直接聊 |

---

## ✨ 核心特性

- 🌐 **Web 聊天界面** — ChatGPT 风格 UI，亮色暖色调主题，响应式布局，手机也能用
- ⚡ **SSE 流式输出** — AI 回复逐字显示，无需等待完整的响应
- 🔄 **多平台支持** — Provider 模式设计，OpenAI-compatible 接口，可扩展多平台
- 🧠 **RAG 知识库** — 上传文档（txt/md/pdf），AI 基于文档内容回答问题
- 🔍 **联网搜索** — 实时搜索最新信息，支持天气查询、新闻资讯等
- 🤖 **工具调用** — 计算器、时间查询、联网搜索、天气查询
- 🎨 **Markdown 渲染** — 代码块语法高亮（highlight.js）、表格、引用、列表
- 💾 **对话持久化** — 本地 JSON 存储，页面刷新不丢对话
- 📊 **Token 统计** — 实时显示每次请求的 Token 消耗（CLI 模式）
- 🛡️ **优雅的错误处理** — 可中断生成、网络重试、友好错误提示
- 📱 **移动端适配** — 侧边栏可折叠，触控友好

---

## 🎬 快速开始

### 环境要求

- **Node.js** ≥ 20.0

```bash
node --version  # ≥ v20
```

### 安装 & 启动

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填上你的 Key

# 3. 启动 Web 界面（推荐）
npm start
# 浏览器打开 → http://localhost:3000

# 或者用命令行模式
npm run chat
```

### 获取 API Key

| 平台 | 注册地址 | 新用户福利 |
|------|----------|-----------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | 送 500 万 Token |

推荐使用 **DeepSeek**，注册即送额度，性价比高。

---

## 📖 使用指南

### Web 界面

```
启动 → npm start → 浏览器打开 http://localhost:3000

界面布局:
┌────────────┬──────────────────────────┐
│  📁 历史对话 │  🥚 Egg 在线              │
│            │                          │
│  + 新建对话  │  用户消息气泡              │
│            │  AI 回复 (流式渲染)        │
│  💬 对话1   │  代码块 (高亮 + 复制按钮)   │
│  💬 对话2   │  工具调用卡片              │
│  💬 对话3   │                          │
│            │  📤 上传知识库文档          │
│  🧠 模型选择器│  ┌─────────────────────┐  │
│  📚 知识库   │  │ 输入问题...    [发送] │  │
│            │  └─────────────────────┘  │
└────────────┴──────────────────────────┘

快捷键: Ctrl+S 保存 · Enter 发送 · Shift+Enter 换行
```

### 命令行模式

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清空当前对话 |
| `/save [名称]` | 保存对话到本地 |
| `/load <名称>` | 加载历史对话 |
| `/list` | 列出所有已保存的对话 |
| `/model <模型名>` | 切换 AI 模型 |
| `/models` | 查看可用模型列表 |
| `/system [提示词]` | 查看/修改系统提示词 |
| `/stats` | 显示 Token 用量统计 |
| `/exit` | 退出（自动保存） |

### 切换平台

编辑 `.env`：

```bash
PROVIDER=deepseek
API_KEY=sk-xxx
MODEL=deepseek-chat
```

---

## 🧠 RAG 知识库使用

1. 在侧边栏点击 **📤 上传文档**
2. 选择 txt/md/pdf 文件上传
3. 文档会自动解析、向量化并存储
4. 提问时 AI 会自动检索知识库内容

**支持的文件格式**：
- `.txt` — 纯文本文件
- `.md` — Markdown 文件
- `.pdf` — PDF 文档（需要 pdf-parse 依赖）

---

## 🔍 联网搜索

AI 会自动识别需要搜索的问题并调用搜索工具，支持：
- 实时天气查询
- 最新新闻资讯
- 事实核查
- 时效性问题

---

## 🏗️ 项目结构

```
ai-chat-cli/
├── server.js            # Web 服务器 — HTTP + SSE 流式代理 + REST API
├── chat.js              # CLI 主程序 — 对话循环 + 命令系统
├── lib/
│   ├── config.js        # 配置管理 — .env 解析、多平台 Provider
│   ├── ui.js            # CLI UI 工具 — 彩色输出、ANSI Markdown 渲染器
│   ├── storage.js       # 持久化 — 对话 CRUD（~/.ai-chat-cli/）
│   ├── rag.js           # RAG 知识库 — 文档解析、向量化、检索
│   └── tools.js         # 工具系统 — 计算器、搜索、天气、时间
├── public/
│   ├── vendor/          # 前端依赖（marked.js, highlight.js）
│   └── index.html       # Web 单页应用 — ChatGPT 风格聊天界面
├── .env.example         # 配置模板
├── package.json
└── README.md
```

---

## 🔧 技术架构

```
                   ┌─────────────────────┐
                   │   Browser (Web UI)   │
                   │  fetch + SSE stream  │
                   └────────┬────────────┘
                            │ HTTP/SSE
                   ┌────────▼────────────┐
                   │     server.js        │
                   │  POST /api/chat      │  ← SSE 代理 + Agent 工具调用
                   │  POST /api/chat      │  ← RAG 知识库检索
                   │  CRUD /api/convs     │  ← 对话管理
                   │  CRUD /api/knowledge │  ← 知识库管理
                   │  serve static/       │  ← 前端页面
                   └────────┬────────────┘
                            │ fetch + ReadableStream
                   ┌────────▼────────────┐
                   │     DeepSeek API     │
                   │  /chat/completions   │
                   │  (SSE stream=true)   │
                   └─────────────────────┘

   ┌─────────────────────────────────────────┐
   │               chat.js (CLI)              │
   │  readline → 命令系统 → streamChat()      │
   │       ↓           ↓          ↓           │
   │  SSE 解析   错误重试    Token 统计       │
   └─────────────────────────────────────────┘

   ┌─────────────────────────────────────────┐
   │                lib/rag.js                │
   │  文档解析 → 文本分割 → 向量化 → 存储      │
   │       ↓                                 │
   │  余弦相似度检索 → 返回相关片段            │
   └─────────────────────────────────────────┘
```

### 核心技术点

| 技术 | 实现 |
|------|------|
| **SSE 流式代理** | 后端 fetch + ReadableStream → 客户端 ReadableStream + 逐行解析 |
| **Web 聊天 UI** | 纯 HTML/CSS/JS，零构建步骤，ChatGPT 风格亮色暖色调主题 |
| **Markdown 渲染** | Web: marked.js + highlight.js · CLI: 自研 ANSI 渲染器（7 种语言高亮） |
| **请求中断** | AbortController 实现安全取消（不丢对话历史） |
| **多平台适配** | Provider 模式封装差异，OpenAI-compatible 接口统一 |
| **RAG 知识库** | 文档解析（pdf-parse）+ 本地向量化 + 余弦相似度检索 |
| **工具调用** | OpenAI Function Calling 格式，支持计算器、搜索、天气、时间 |

---

## 📄 License

MIT

---

## 🙋 About

个人 AI 应用开发学习项目 — 从命令行到 Web 的全栈实践。

如果你觉得有用，欢迎 Star ⭐！

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📝 更新日志

### v2.0
- ✨ 新增 RAG 知识库功能（文档上传、解析、向量化、检索）
- ✨ 新增联网搜索工具（Bing 搜索 + 天气查询）
- ✨ 新增工具调用系统（计算器、时间、搜索、天气）
- 🎨 完善蛋蛋人物形象（女性主义者、温暖可爱、思考过程）
- 🎨 聊天气泡自适应宽度
- 🐛 修复 JSON 反序列化错误（tool_result 角色）
- 🐛 修复重复回复问题
- 🐛 修复联网搜索超时问题（国内网络适配）