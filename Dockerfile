# ============================================================
#  Egg Chat — Docker 镜像
#  多阶段构建：最小化最终镜像体积
# ============================================================

# ── Stage 1: 安装依赖 ──
FROM node:20-alpine AS deps
WORKDIR /app

# 只复制依赖文件，利用 Docker 层缓存
COPY package.json ./

# 安装生产依赖（跳过 devDependencies）
RUN npm install --omit=dev

# ── Stage 2: 运行镜像 ──
FROM node:20-alpine
WORKDIR /app

# 创建非 root 用户
RUN addgroup -S egg && adduser -S egg -G egg

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制应用代码
COPY server.js ./
COPY chat.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# 创建数据目录并设置权限
RUN mkdir -p /app/data && chown -R egg:egg /app

# 切换到非 root 用户
USER egg

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)})"

# 启动
CMD ["node", "server.js"]
