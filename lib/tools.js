// ============================================
// AI Agent 工具系统
// 定义可调用的工具 + 执行器
//
// 每个工具包含:
//   definition — OpenAI-compatible function 定义
//   execute(args) — 实际执行函数
// ============================================

// --------------------------------------------------
// 工具定义（OpenAI Function Calling 格式）
// --------------------------------------------------
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: '安全地计算数学表达式。支持: 加减乘除、幂运算 (**)、三角函数 (sin/cos/tan)、对数 (log)、平方根 (sqrt)、圆周率 (PI)。示例: "2 + 3 * 4", "sqrt(16) * sin(PI/2)"',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，如 "2 + 3 * 4" 或 "sqrt(25) * 10"',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前日期和时间。可以指定时区，默认返回中国时间。用于回答"现在几点""今天几号""XX时区现在是什么时间"等问题。',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: '时区标识，如 "Asia/Shanghai"（中国）、"America/New_York"（纽约）、"Europe/London"（伦敦）。不填默认中国时区。',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '在互联网上搜索实时信息。当用户询问时效性问题、最新新闻、事实核查时使用。返回搜索结果的摘要。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，用简洁的语言描述要查的内容',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的实时天气信息。当用户询问天气、温度、天气状况时使用。',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，如"北京"、"上海"、"广州"',
          },
        },
        required: ['city'],
      },
    },
  },
];

// --------------------------------------------------
// 安全数学表达式求值
// 只允许数学运算，禁止代码注入
// --------------------------------------------------
function safeMathEval(expression) {
  // 预处理：将常用数学函数名添加 Math. 前缀
  expression = expression.replace(
    /\b(sin|cos|tan|log2|log10|sqrt|abs|pow|round|ceil|floor)\s*\(/gi,
    'Math.$1('
  );
  // log 特殊处理（不能匹配 log2/log10）
  expression = expression.replace(/\blog\s*\(/gi, 'Math.log(');
  // min/max 特殊处理
  expression = expression.replace(/\bmin\s*\(/gi, 'Math.min(');
  expression = expression.replace(/\bmax\s*\(/gi, 'Math.max(');
  expression = expression.replace(/\bPI\b/gi, 'Math.PI');
  expression = expression.replace(/\bE\b/gi, 'Math.E');

  // 安全检查：移除所有已知函数调用后，不应有裸字母
  const cleaned = expression.replace(/\bMath\.\w+\b/g, '0');
  if (/[a-df-zA-DF-Z]/.test(cleaned)) {
    throw new Error('表达式包含不允许的字符');
  }

  // 用 Function 构造函数在严格模式下求值
  const result = new Function('Math', `
    const { sin, cos, tan, log, log2, log10, sqrt, abs, pow, round, ceil, floor, max, min, PI, E } = Math;
    "use strict";
    return (${expression});
  `)(Math);

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('计算结果不是有效数字');
  }

  return parseFloat(result.toPrecision(10));
}

async function searchDuckDuckGo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = await resp.json();

  const parts = [];
  if (data.AbstractText) parts.push(data.AbstractText);
  if (data.Answer) parts.push('📌 ' + data.Answer);
  if (data.RelatedTopics && data.RelatedTopics.length > 0) {
    const topics = data.RelatedTopics
      .filter((t) => t.Text)
      .slice(0, 3)
      .map((t) => '• ' + t.Text.replace(/<[^>]+>/g, ''));
    if (topics.length > 0 && !data.AbstractText) {
      parts.push('相关内容:\n' + topics.join('\n'));
    }
  }

  if (parts.length === 0) {
    throw new Error('未找到直接搜索结果');
  }
  return parts.join('\n\n');
}

async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN`;
  console.log(`[搜索] 开始访问 Bing: ${url}`);
  const startTime = Date.now();
  const resp = await fetch(url, { 
    signal: AbortSignal.timeout(10000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  console.log(`[搜索] Bing 返回: ${resp.status}, 耗时: ${Date.now() - startTime}ms`);
  const html = await resp.text();

  const results = [];
  
  const titleRegex = /<h2[^>]*><a[^>]*>(.*?)<\/a><\/h2>/gi;
  const descRegex = /<p class="b_lineclamp2">(.*?)<\/p>/gi;
  
  let titles = [];
  let match;
  while ((match = titleRegex.exec(html)) !== null) {
    titles.push(match[1].replace(/<[^>]+>/g, '').trim());
  }
  
  let descs = [];
  while ((match = descRegex.exec(html)) !== null) {
    descs.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  for (let i = 0; i < Math.min(titles.length, descs.length, 3); i++) {
    results.push(`【来源 ${i + 1}】标题: ${titles[i]}\n内容摘要: ${descs[i]}`);
  }

  if (results.length === 0) {
    throw new Error('未找到搜索结果');
  }
  return `搜索到以下信息（共 ${results.length} 条）：\n\n${results.join('\n\n')}\n\n---\n请根据以上信息直接回答用户问题，无需再调用搜索工具。`;
}

async function searchWeb(query) {
  let lastError;
  
  const searchers = [
    { name: 'Bing', fn: searchBing },
    { name: 'DuckDuckGo', fn: searchDuckDuckGo },
  ];

  for (const { name, fn } of searchers) {
    try {
      return await fn(query);
    } catch (err) {
      lastError = err;
      console.warn(`搜索服务 ${name} 失败: ${err.message}`);
    }
  }

  return `搜索失败: ${lastError?.message || '所有搜索服务均不可用'}。请检查网络连接或稍后重试。`;
}

async function getWeather(city) {
  const cityCodes = {
    '北京': '101010100', '上海': '101020100', '广州': '101280101', '深圳': '101280601',
    '杭州': '101210101', '南京': '101190101', '成都': '101270101', '武汉': '101200101',
    '西安': '101110101', '重庆': '101040100', '天津': '101030100', '苏州': '101190401',
    '郑州': '101180101', '长沙': '101250101', '青岛': '101120101', '厦门': '101230201',
    '大连': '101070101', '沈阳': '101070101', '哈尔滨': '101050101', '长春': '101060101',
    '昆明': '101290101', '贵阳': '101260101', '南宁': '101300101', '福州': '101230101',
    '合肥': '101220101', '济南': '101120101', '石家庄': '101090101', '太原': '101100101',
    '兰州': '101160101', '西宁': '101150101', '银川': '101170101', '乌鲁木齐': '101130101',
    '呼和浩特': '101080101', '拉萨': '101140101', '海口': '101310101', '三亚': '101310201',
  };
  
  const cityCode = cityCodes[city] || '101010100';
  
  try {
    const url = `https://www.weather.com.cn/weather/${cityCode}.shtml`;
    const resp = await fetch(url, { 
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await resp.text();
    
    const tempMatch = html.match(/<span class="temp">([^<]+)<\/span>/);
    const weatherMatch = html.match(/<span class="weather">([^<]+)<\/span>/);
    const windMatch = html.match(/<span class="wind">([^<]+)<\/span>/);
    const windLevelMatch = html.match(/<span class="windLevel">([^<]+)<\/span>/);
    
    if (tempMatch && weatherMatch) {
      const temp = tempMatch[1];
      const weather = weatherMatch[1];
      const wind = windMatch ? windMatch[1] : '';
      const windLevel = windLevelMatch ? windLevelMatch[1] : '';
      
      return `${city}当前天气：${weather}，温度${temp}，${wind}${windLevel}`;
    }
    
    throw new Error('未找到天气数据');
  } catch (err) {
    console.warn(`天气查询失败，使用搜索回退: ${err.message}`);
    return await searchWeb(`${city}天气`);
  }
}

// --------------------------------------------------
// 获取当前时间
// --------------------------------------------------
function getTime(timezone) {
  const tz = timezone || 'Asia/Shanghai';
  try {
    const now = new Date();
    const formatted = now.toLocaleString('zh-CN', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return `${formatted} (${tz})`;
  } catch {
    // 时区无效时回退
    const now = new Date();
    return now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }) + ' (Asia/Shanghai)';
  }
}

// --------------------------------------------------
// 工具执行入口
// @param {string} name — 工具名
// @param {object} args — 参数对象
// @returns {string} 执行结果
// --------------------------------------------------
export async function executeTool(name, args) {
  switch (name) {
    case 'calculator': {
      const expr = args.expression?.trim();
      if (!expr) throw new Error('缺少 expression 参数');
      const result = safeMathEval(expr);
      return `${expr} = ${result}`;
    }

    case 'get_current_time': {
      return getTime(args.timezone);
    }

    case 'web_search': {
      const query = args.query?.trim();
      if (!query) throw new Error('缺少 query 参数');
      return await searchWeb(query);
    }

    case 'get_weather': {
      const city = args.city?.trim();
      if (!city) throw new Error('缺少 city 参数');
      return await getWeather(city);
    }

    default:
      return `未知工具: ${name}`;
  }
}
