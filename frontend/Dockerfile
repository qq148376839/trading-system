# Frontend 服务 Dockerfile
FROM node:20-alpine AS builder

# 安装 pnpm
RUN npm install -g pnpm

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 lock 文件
COPY package.json pnpm-lock.yaml* package-lock.json* ./

# 安装依赖（优先使用 pnpm，如果没有 pnpm-lock.yaml 则使用 npm）
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci; \
    else \
      echo "Warning: No lock file found, using pnpm install"; \
      pnpm install; \
    fi

# 复制源代码
COPY . .

# 构建 Next.js 应用
RUN if [ -f pnpm-lock.yaml ] || [ ! -f package-lock.json ]; then \
      pnpm run build; \
    else \
      npm run build; \
    fi

# 生产环境镜像
FROM node:20-alpine AS runner

# 安装 curl 用于健康检查
RUN apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV production

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制构建产物（standalone 模式）
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# 暴露端口
EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# 健康检查（检查根路径）
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# 启动服务（standalone 模式的入口文件）
CMD ["node", "server.js"]

