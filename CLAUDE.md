# 🥚 Egg — 智能 AI 聊天应用

> 一份给未来自己（和 AI 伙伴）的指南，让这个项目持续成长。

---

## 📋 项目定位

一个 **全栈 AI 聊天应用**，面向简历展示和学习实践。目标用户：我自己 + 面试官。

核心卖点：
1. Web + CLI 双模式运行
2. 手写 SSE 流式解析（不依赖第三方 SDK）
3. 多 AI 平台 Provider 模式适配
4. 自研终端 Markdown → ANSI 渲染器
5. 零构建步骤，`npm start` 即用

---

## 🏗️ 架构总览

```
ai-chat-cli/
├── server.js              # Web 服务器 (Node 原生 http 模块，纯手写)
│                           路由分发 → API 处理 / SSE 代理 / 静态文件
├── chat.js                # CLI 对话程序 (readline 交互循环)
├── lib/
│   ├── config.js          # 配置管理 + 多平台 Provider 定义
│   ├── tools.js           # Agent 工具系统（计算器/时间/搜索 + Function Calling）
│   ├── ui.js              # CLI UI 工具：Markdown→ANSI 渲染、颜色、帮助
│   └── storage.js         # 对话持久化 CRUD (~/.ai-chat-cli/conversations/)
├── public/
│   └── index.html         # Web SPA 聊天界面（纯 HTML/CSS/JS）
├── .env.example           # 配置模板
├── package.json
└── README.md
```

### 数据流

```
Browser/CLI --[HTTP POST]--> server.js --[fetch+SSE stream]--> DeepSeek API
     ↑                            ↓                             ↓
     └── SSE 逐字回传 ──── ReadableStream 逐块解析        [Agent 循环]
                                                        tool_calls → 执行工具
                                                        ↓           ↓
                                                      calculator  get_time  web_search
                                                        ↓           ↓        ↓
                                                      结果返回 → 对话历史 → 再次请求 AI
```

### 关键设计决策

| 决策 | 理由 |
|------|------|
| **不依赖 Express** | 简历展示手写 HTTP 服务器的能力 |
| **不依赖 dotenv** | 展示自研 .env 解析 |
| **不依赖前端框架** | 纯 HTML/CSS/JS 降低面试官心智负担 |
| **SSE 手动解析** | 展示对流式协议的理解深度 |
| **CLI Markdown 自研** | 展示正则+ANSI 渲染能力 |
| **Web 用 marked.js CDN** | Markdown 渲染复杂度高，用现成库合理 |

---

## 🗺️ 代码导航

### `server.js` — Web 服务器核心
- `matchRoute(method, url)` — 路由表，添加新 API 在这里注册
- `handleChat()` — SSE 流式代理，核心的流式转发逻辑
- `handle*Conversation*()` — RESTful 对话 CRUD
- `serveStatic()` — 静态文件 + SPA fallback
- `startServer(port)` — 导出函数，可被其他模块引用

### `lib/config.js` — 配置层
- `PROVIDERS` — 添加新平台只改这个对象
- `loadConfig()` — 返回配置对象，被 server.js 和 chat.js 共用
- `getSystemPrompt()` — 全局默认提示词

### `lib/ui.js` — CLI 渲染器
- `renderMarkdown(text)` — 主入口，逐行解析
- `renderCodeBlock()` — 带行号的代码块
- `highlightLine()` — 单行语法高亮（7 语言关键词表）
- `LANG_ALIAS` — 语言别名映射
- `KEYWORD_PATTERNS` — 各语言关键词正则

### `lib/tools.js` — Agent 工具系统
- `TOOLS` — OpenAI-compatible 工具定义数组（calculator / get_current_time / web_search）
- `executeTool(name, args)` — 工具执行入口
- `safeMathEval()` — 安全数学表达式求值（防注入）
- `searchWeb()` — DuckDuckGo 免费搜索 API

### `lib/storage.js` — 持久化层
- 数据目录：`~/.ai-chat-cli/conversations/`
- 文件格式：JSON，包含 `version/savedAt/messageCount/messages`
- Web 和 CLI 共享同一存储，对话互通

### `public/index.html` — Web 前端
- **亮色主题**，暖色调（奶油白 + 橙色 accent）
- 吉祥物：🥚（鸡蛋），AI 头像
- 用户头像：👩（女性）
- 左侧栏：新建对话 + 模型选择 + 历史列表
- 右侧：气泡聊天 + 流式渲染 + 代码高亮
- 响应式：768px 断点，侧边栏折叠
- 无框架依赖，marked.js + highlight.js 通过 CDN 加载

---

## ✨ 当前功能清单

### Web 界面
- [x] SSE 流式对话渲染
- [x] AI Agent 工具调用（计算器/时间/搜索 + 可视化卡片）
- [x] 对话历史侧边栏（加载/删除）
- [x] 模型切换下拉菜单
- [x] 代码块语法高亮 + 复制按钮
- [x] 快速提问按钮
- [x] Ctrl+S 保存 · Enter 发送
- [x] 亮色可爱主题
- [x] 移动端响应式
- [x] 加载动画
- [x] 错误提示横幅

### CLI 命令行
- [x] 流式输出 + 中断恢复
- [x] 10 个命令 (/help /clear /save /load /list /model /models /system /stats /exit)
- [x] ANSI Markdown 渲染（7 种语言代码高亮）
- [x] 网络重试（2 次，指数退避）
- [x] Token 用量统计
- [x] 彩色终端输出
- [x] Ctrl+C 安全中断

### 后端
- [x] HTTP + SSE 双协议
- [x] RESTful API（对话 CRUD + 配置查询）
- [x] 4 家 AI 平台适配
- [x] Agent 循环 — AI 自动调用工具（计算/时间/搜索），多轮对话整合结果
- [x] 静态文件服务 + SPA fallback

---

## 🚀 升级路线图

按优先级排列，每个阶段可独立交付。

### Phase 1：体验打磨（近期）
- [ ] **Web: 对话重命名** — 双击侧边栏标题可编辑
- [ ] **Web: 暗色主题切换** — 亮/暗一键切换，存 localStorage
- [ ] **Web: 滚动到底部按钮** — 用户往上翻时出现「↓ 回到底部」
- [ ] **Web: 输入框 auto-focus 优化** — 页面加载和对话切换时自动聚焦
- [ ] **CLI: 多行输入** — 支持粘贴多行文本
- [ ] **错误重连提示** — Web 端断线时提示重试

### Phase 2：AI 能力增强（中期）
- [x] **Function Calling / Agent** — AI 自动调用工具（计算器/时间/搜索），多轮整合
- [ ] **图片理解** — 支持粘贴/拖入图片，调用 GPT-4o / DeepSeek-VL
- [ ] **联网搜索** — `/search` 命令调用搜索 API 增强回答
- [ ] **对话摘要自动命名** — 保存时调用 AI 生成对话标题
- [ ] **System Prompt 模板** — 预设角色模板（程序员/翻译/写作/面试官）
- [ ] **Temperature/top_p 滑块** — Web 端可视化调节生成参数

### Phase 3：工程化（中远期）
- [ ] **多会话管理** — 同时维护多个对话 tab
- [ ] **消息编辑 & 分支** — 编辑已发送消息，重新生成回复
- [ ] **导出对话** — Markdown / PDF 导出
- [ ] **用量统计面板** — Web 端可视化 Token 消耗图表
- [ ] **单元测试** — vitest 覆盖核心模块
- [ ] **Docker 部署** — 一键启动脚本

### Phase 4：差异化亮点（远期）
- [ ] **MCP Tool 调用** — Claude 风格的 function calling 可视化
- [ ] **本地模型支持** — Ollama 集成，完全离线运行
- [ ] **语音输入** — Web Speech API
- [ ] **插件系统** — 用户可扩展自定义命令
- [ ] **PWA 支持** — 可安装到桌面

---

## 🔧 开发指南

### 添加新的 AI 平台

只需改 `lib/config.js` 的 `PROVIDERS` 对象：

```js
newplatform: {
  name: '新平台名',
  baseURL: 'https://api.newplatform.com/v1',
  models: ['model-a', 'model-b'],
  defaultModel: 'model-a',
  website: 'https://platform.newplatform.com',
}
```

其他代码完全不用动 — 全程走 OpenAI-compatible 接口。

### 添加新的 CLI 命令

在 `chat.js` 的 `commands` 对象中添加：

```js
'/mycommand': {
  desc: '命令描述',
  usage: '/mycommand <参数>',
  handler: (args) => {
    // 命令逻辑
    success('完成！');
  },
},
```

### 添加新的 Web API 端点

1. 在 `server.js` 的 `matchRoute()` 注册路由
2. 添加对应的 handler 函数
3. Web 前端用 `fetch('/api/xxx')` 调用

### 代码风格

- ES Module (`import/export`)
- 函数式为主，避免深层类继承
- 注释用中文 + 分隔线
- API 路径统一 `/api/` 前缀
- 文件顶部写模块说明
- 零外部构建工具，保持 `node server.js` 即可运行

### 测试

```bash
# 语法检查
node --check server.js && node --check chat.js && node --check lib/*.js

# 启动 Web 服务器
npm start

# API 测试
curl http://localhost:3000/api/config
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"你好"}]}'

# 启动 CLI
npm run chat
```

---

## ⚠️ 已知问题 & 技术债

1. **CLI 模式的流式输出** — 加载动画 `ora` 在 Windows 终端偶有残影
2. **Web SSE 解析** — `buffer` 分割逻辑在极端情况可能截断多字节 emoji
3. **存储并发安全** — 文件读写未加锁，多 Tab 同时保存可能冲突
4. **无鉴权机制** — Web 服务器直接暴露，仅适合本地使用
5. **CI/CD 未配置** — 无自动化测试/部署流程
6. **TypeScript 迁移** — 随着项目增长，建议逐步迁移到 TS

---

## 📝 给未来的提示

- **CLI 和 Web 共享 `lib/` 层**，修改 config/storage 会影响两端
- **`.env` 不进 git**，但 `.env.example` 需要保持最新
- **对话存储是全局的**，CLI 保存的对话 Web 也能看到
- **Node.js ≥ 20** 是硬要求，用到了原生 fetch、ReadableStream、crypto
- **npm start 默认启动 Web 服务器**，这是主推模式
- **简历关键词**：SSE 流式协议、ReadableStream、Provider 模式、AbortController、ANSI 渲染引擎、RESTful API 设计、零构建全栈
