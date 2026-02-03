# Frontend 服务 Dockerfile
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 接收构建参数（NEXT_PUBLIC_API_URL 需要在构建时注入）
ARG NEXT_PUBLIC_API_URL=http://localhost:3001

# 设置环境变量（Next.js 构建时需要）
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# 启用 corepack 并激活 pnpm（固定版本，避免 latest 漂移）
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# 复制依赖清单
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 确保 public 目录存在（Next.js 需要）
RUN mkdir -p public

# 构建 Next.js 应用（此时 NEXT_PUBLIC_API_URL 已可用）
RUN pnpm run build

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
# public 目录现在已存在于源代码中，可以直接复制
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
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

