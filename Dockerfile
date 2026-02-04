# 统一构建镜像 - 单容器部署（前端 + 后端）
# 使用多阶段构建优化镜像大小

# ============================================
# 阶段 1: 构建前端
# ============================================
FROM node:20-alpine AS frontend-builder

# 启用 corepack 并激活 pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app/frontend

# 复制前端依赖文件
COPY frontend/package.json frontend/pnpm-lock.yaml ./

# 安装前端依赖
RUN pnpm install --frozen-lockfile

# 复制前端源代码
COPY frontend/ ./

# 构建前端（生产环境使用相对路径 /api）
ENV NEXT_PUBLIC_API_URL=/api
ENV NODE_ENV=production
RUN pnpm run build

# ============================================
# 阶段 2: 构建后端
# ============================================
FROM node:20 AS api-builder

# 安装构建依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# 启用 corepack 并激活 pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app/api

# 复制后端依赖文件
COPY api/package.json api/pnpm-lock.yaml ./

# 安装后端依赖
RUN pnpm install --frozen-lockfile

# 复制后端源代码
COPY api/ ./

# 构建后端 TypeScript 代码
RUN pnpm run build

# ============================================
# 阶段 3: 生产运行环境
# ============================================
FROM node:20-slim AS runner

# 安装运行时依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# 启用 corepack 并激活 pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# 创建非 root 用户
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs

# ============================================
# 复制后端构建产物和依赖
# ============================================
COPY --from=api-builder --chown=nodejs:nodejs /app/api/dist ./api/dist
COPY --from=api-builder --chown=nodejs:nodejs /app/api/package.json ./api/
COPY --from=api-builder --chown=nodejs:nodejs /app/api/node_modules ./api/node_modules

# 复制启动相关脚本
COPY --from=api-builder --chown=nodejs:nodejs /app/api/conditional-longport.js ./api/
COPY --from=api-builder --chown=nodejs:nodejs /app/api/startup-check.js ./api/

# ============================================
# 复制前端构建产物
# ============================================
# Next.js standalone 模式的输出
COPY --from=frontend-builder --chown=nodejs:nodejs /app/frontend/.next/standalone ./frontend/
COPY --from=frontend-builder --chown=nodejs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-builder --chown=nodejs:nodejs /app/frontend/public ./frontend/public

# 复制前端 package.json（standalone 模式需要）
COPY --from=frontend-builder --chown=nodejs:nodejs /app/frontend/package.json ./frontend/

# ============================================
# 复制启动脚本
# ============================================
COPY --chown=nodejs:nodejs deploy/start-all.sh ./

# 设置执行权限
RUN chmod +x start-all.sh

# 切换到非 root 用户
USER nodejs

# 暴露端口（只暴露后端端口，前端通过后端代理访问）
EXPOSE 3001

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001
ENV FRONTEND_PORT=3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# 启动脚本会同时运行前端和后端
CMD ["./start-all.sh"]
