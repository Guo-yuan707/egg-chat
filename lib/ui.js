// ============================================
// UI 工具模块
// 终端彩色输出、Markdown 渲染、帮助菜单等
// ============================================

import chalk from 'chalk';

// --------------------------------------------------
// 终端宽度
// --------------------------------------------------
function getWidth() {
  return process.stdout.columns || 80;
}

// --------------------------------------------------
// 简单的代码语法高亮
// 针对不同语言的关键词、字符串、注释、数字着色
// --------------------------------------------------

const KEYWORD_PATTERNS = {
  js: /\b(const|let|var|function|async|await|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|class|extends|import|export|default|from|typeof|instanceof|void|yield|static|get|set|this|super|true|false|null|undefined|Promise|console|JSON|Math|Array|Object|String|Number|Map|Set|Symbol)\b/g,
  ts: /\b(const|let|var|function|async|await|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|class|extends|implements|interface|type|enum|import|export|default|from|typeof|instanceof|void|yield|static|get|set|this|super|true|false|null|undefined|private|public|protected|readonly|abstract|as|is|keyof|infer|never|unknown|any)\b/g,
  python: /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|raise|yield|lambda|and|or|not|in|is|True|False|None|self|cls|async|await|print|range|len|int|str|float|list|dict|set|tuple|bool|open|zip|enumerate|map|filter|sorted|reversed|super|global|nonlocal|del|assert)\b/g,
  bash: /\b(echo|cd|ls|pwd|mkdir|rm|cp|mv|cat|grep|find|chmod|chown|export|source|alias|if|then|else|elif|fi|for|while|do|done|case|esac|function|exit|npm|node|git|docker|curl|wget|ssh|tar|npm|yarn|pnpm|npx|env|unset|set)\b/g,
  sql: /\b(SELECT|FROM|WHERE|INSERT|INTO|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|DISTINCT|COUNT|SUM|AVG|MAX|MIN|UNION|ALL|SET|VALUES|PRIMARY|KEY|FOREIGN|REFERENCES|CASCADE|EXISTS|CASE|WHEN|THEN|ELSE|END|ASC|DESC)\b/g,
  go: /\b(func|package|import|return|if|else|for|range|switch|case|default|break|continue|go|defer|chan|select|type|struct|interface|map|var|const|true|false|nil|error|string|int|float64|bool|byte|append|make|len|cap|panic|recover|fallthrough)\b/g,
  rust: /\b(fn|let|mut|const|if|else|for|while|loop|match|return|struct|enum|impl|trait|pub|use|mod|self|super|crate|true|false|Some|None|Ok|Err|Result|Option|Vec|String|Box|as|in|ref|move|async|await|dyn|where|type|static|unsafe|extern)\b/g,
};

// 语言别名映射
const LANG_ALIAS = {
  js: 'js', javascript: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'ts', typescript: 'ts',
  py: 'python', python: 'python', python3: 'python',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', terminal: 'bash',
  sql: 'sql', mysql: 'sql', postgresql: 'sql', psql: 'sql',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', html: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown',
  java: 'java', kotlin: 'java', scala: 'java',
  c: 'c', cpp: 'c', 'c++': 'c', h: 'c',
  php: 'php', rb: 'ruby', ruby: 'ruby', lua: 'lua',
};

// --------------------------------------------------
// 对单行代码应用语法高亮
// --------------------------------------------------
function highlightLine(line, langKey) {
  const pattern = KEYWORD_PATTERNS[langKey];
  let result = line;

  // 注释（优先级最高，不再匹配其他）
  const isScript = ['js', 'ts', 'go', 'rust', 'java', 'c', 'php'].includes(langKey);
  const isScriptLike = isScript || ['ruby', 'python', 'lua'].includes(langKey);

  if (langKey === 'python' || langKey === 'bash' || langKey === 'ruby' || langKey === 'yaml') {
    result = result.replace(/(\s#[^']*$)/g, (m) => chalk.dim(m));
  }
  if (isScript || langKey === 'sql') {
    result = result.replace(/(\/\/.*$)/g, (m) => chalk.dim(m));
  }

  // 字符串
  result = result.replace(/('(?:[^'\\]|\\.)*')/g, (m) => chalk.green(m));
  result = result.replace(/("(?:[^"\\]|\\.)*")/g, (m) => chalk.green(m));
  result = result.replace(/(`(?:[^`\\]|\\.)*`)/g, (m) => chalk.green(m));

  // 数字
  result = result.replace(/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, (m) => chalk.yellow(m));

  // 关键词
  if (pattern) {
    result = result.replace(pattern, (m) => chalk.cyan(m));
  }

  return result;
}

// --------------------------------------------------
// 渲染代码块（带语言标签 + 行号 + 左边框）
// --------------------------------------------------
function renderCodeBlock(code, lang) {
  const langKey = LANG_ALIAS[lang?.toLowerCase()] || null;
  const label = lang || 'code';
  const lines = code.split('\n');
  const width = Math.min(getWidth() - 4, 72);

  const out = [];
  out.push('');
  out.push('  ' + chalk.dim('┌─ ' + label + ' ' + '─'.repeat(Math.max(width - label.length - 2, 2))));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const highlighted = langKey ? highlightLine(line, langKey) : chalk.dim(line);

    // 截断过长的行
    const display = line.length > width ? line.slice(0, width - 3) + '...' : line;
    const highlightedDisplay = langKey ? highlightLine(display, langKey) : chalk.dim(display);

    out.push('  ' + chalk.dim('│') + ' ' + highlightedDisplay);
  }

  out.push('  ' + chalk.dim('└' + '─'.repeat(Math.min(width, 50))));
  out.push('');

  return out.join('\n');
}

// --------------------------------------------------
// 渲染行内格式：粗体、斜体、行内代码、链接
// --------------------------------------------------
function renderInline(text) {
  if (!text) return '';

  let result = text;

  // 行内代码 `...`（最高优先级，内部不解析其他格式）
  result = result.replace(/`([^`\n]+)`/g, (_, t) => chalk.bgBlack.white(` ${t} `));

  // 粗体 **...** 或 __...__
  result = result.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  result = result.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));

  // 斜体 *...* 或 _..._
  result = result.replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t));
  result = result.replace(/_(.+?)_/g, (_, t) => chalk.italic(t));

  // 链接 [text](url) — 显示为可点击风格
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, t, u) => chalk.underline.blue(t) + ' ' + chalk.dim(`⟨${u}⟩`)
  );

  // 删除线 ~~...~~
  result = result.replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t));

  return result;
}

// --------------------------------------------------
// 主 Markdown 渲染器
// 逐行解析：代码块、标题、列表、引用、分隔线、普通段落
// --------------------------------------------------
export function renderMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const out = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines = [];
  const width = getWidth();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── 代码块 ──
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // 结束代码块
        out.push(renderCodeBlock(codeLines.join('\n'), codeLang));
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        // 开始代码块
        codeLang = line.trimStart().slice(3).trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // ── 空行 ──
    if (!line.trim()) {
      out.push('');
      continue;
    }

    // ── 标题 # ~ ###### ──
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const title = renderInline(hMatch[2]);
      if (level === 1) out.push(chalk.bold.underline.hex('#FFD700')(title));
      else if (level === 2) out.push(chalk.bold.hex('#87CEEB')(title));
      else if (level === 3) out.push(chalk.bold.cyan(title));
      else out.push(chalk.bold.dim(title));
      continue;
    }

    // ── 分隔线 --- / *** / ___ ──
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      out.push(chalk.dim('─'.repeat(Math.min(width - 4, 60))));
      continue;
    }

    // ── 引用 > ──
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s?/, '');
      out.push('  ' + chalk.dim('▌') + ' ' + chalk.italic.dim(renderInline(quoteText)));
      continue;
    }

    // ── 无序列表 - / * / + ──
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      const indent = '  '.repeat(Math.floor(ulMatch[1].length / 2));
      out.push(indent + chalk.cyan('•') + ' ' + renderInline(ulMatch[2]));
      continue;
    }

    // ── 有序列表 1. 2. ──
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const indent = '  '.repeat(Math.floor(olMatch[1].length / 3));
      out.push(indent + chalk.cyan(olMatch[2] + '.') + ' ' + renderInline(olMatch[3]));
      continue;
    }

    // ── 普通段落 ──
    out.push(renderInline(line));
  }

  // 未闭合的代码块
  if (inCodeBlock && codeLines.length > 0) {
    out.push(renderCodeBlock(codeLines.join('\n'), codeLang));
  }

  return out.join('\n');
}

// ============================================================
//  快捷输出辅助函数
// ============================================================

export function success(msg) {
  console.log('  ' + chalk.green('✔') + ' ' + msg);
}

export function error(msg) {
  console.log('  ' + chalk.red('✘') + ' ' + msg);
}

export function info(msg) {
  console.log('  ' + chalk.blue('ℹ') + ' ' + msg);
}

export function warn(msg) {
  console.log('  ' + chalk.yellow('⚠') + ' ' + msg);
}

export function dim(msg) {
  console.log('  ' + chalk.dim(msg));
}

export function hr() {
  console.log(chalk.dim('─'.repeat(Math.min(getWidth() - 4, 60))));
}

// --------------------------------------------------
// 启动欢迎横幅
// --------------------------------------------------
export function welcome(config) {
  const boxWidth = 42;

  console.log('');
  console.log(
    chalk.cyan('╔') +
    chalk.cyan('═'.repeat(boxWidth)) +
    chalk.cyan('╗')
  );
  console.log(
    chalk.cyan('║') +
    '  🤖 ' +
    chalk.bold('AI Chat CLI v2.0') +
    ' '.repeat(boxWidth - 20) +
    chalk.cyan('║')
  );
  console.log(
    chalk.cyan('║') +
    '  ' +
    config.providerName +
    ' 智能对话终端' +
    ' '.repeat(boxWidth - 11 - config.providerName.length) +
    chalk.cyan('║')
  );
  console.log(
    chalk.cyan('╚') +
    chalk.cyan('═'.repeat(boxWidth)) +
    chalk.cyan('╝')
  );
  console.log('');
  console.log(
    chalk.dim(
      `  模型: ${config.model}  │  /help 查看命令  │  /exit 退出`
    )
  );
  console.log('');
}

// --------------------------------------------------
// 帮助菜单
// --------------------------------------------------
export function showHelp() {
  const cmds = [
    ['/exit', '退出程序'],
    ['/clear', '清空当前对话'],
    ['/save [名称]', '保存当前对话到本地'],
    ['/load <名称>', '加载已保存的对话'],
    ['/list', '列出所有已保存的对话'],
    ['/model <模型名>', '切换 AI 模型'],
    ['/models', '查看当前可用的模型列表'],
    ['/system <提示词>', '修改 AI 的系统提示词'],
    ['/stats', '显示本次对话的 Token 统计'],
    ['/help', '显示此帮助信息'],
  ];

  console.log('');
  console.log(chalk.bold('  📋 可用命令'));
  console.log('');
  for (const [cmd, desc] of cmds) {
    console.log(`    ${chalk.cyan(cmd.padEnd(22))} ${chalk.dim(desc)}`);
  }
  console.log('');
}

// --------------------------------------------------
// Token 用量展示
// --------------------------------------------------
export function showUsage(usage) {
  if (!usage?.total_tokens) return;
  const p = usage.prompt_tokens?.toLocaleString() || '?';
  const c = usage.completion_tokens?.toLocaleString() || '?';
  const t = usage.total_tokens?.toLocaleString() || '?';
  console.log(chalk.dim(`  ── Token: 输入 ${p} + 输出 ${c} = 总计 ${t} ──`));
}
