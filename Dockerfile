# 统一构建镜像 - 单容器部署（前端 + 后端）
# 使用多阶段构建优化镜像大小

# ============================================
# 阶段 1: 构建前端
# ============================================
FROM node:20-alpine AS frontend-builder

# 配置 npm 使用淘宝镜像源（解决国内网络问题）
RUN npm config set registry https://registry.npmmirror.com

# 直接用 npm 安装 pnpm（不用 corepack，避免网络问题）
RUN npm install -g pnpm@10.28.2

WORKDIR /app/frontend

# 复制前端依赖文件
COPY frontend/package.json frontend/pnpm-lock.yaml ./

# 配置 pnpm 使用淘宝镜像源
RUN pnpm config set registry https://registry.npmmirror.com

# 安装前端依赖
RUN pnpm install --frozen-lockfile

# 复制前端源代码
COPY frontend/ ./

# 构建前端（生产环境使用相对路径 /api）
ENV NEXT_PUBLIC_API_URL=/api
ENV NODE_ENV=production
ENV DOCKER_ENV=true
RUN pnpm run build

# ============================================
# 阶段 2: 构建后端（使用 Ubuntu 24.04 以获取 GLIBC 2.39）
# ============================================
FROM ubuntu:24.04 AS api-builder

# 配置 apt 使用阿里云镜像源（解决国内网络问题）
RUN sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/ubuntu.sources && \
    sed -i 's/security.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/ubuntu.sources

# 安装 Node.js 20 和构建依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    build-essential && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# 配置 npm 使用淘宝镜像源（解决国内网络问题）
RUN npm config set registry https://registry.npmmirror.com

# 直接用 npm 安装 pnpm（不用 corepack，避免网络问题）
RUN npm install -g pnpm@10.28.2

WORKDIR /app/api

# 复制后端依赖文件
COPY api/package.json api/pnpm-lock.yaml ./

# 配置 pnpm 使用淘宝镜像源
RUN pnpm config set registry https://registry.npmmirror.com

# 安装后端依赖
RUN pnpm install --no-frozen-lockfile

# 复制后端源代码
COPY api/ ./

# 直接下载 native binding 到 longport 主包目录（这是 longport 首先查找的位置）
RUN curl -sL https://registry.npmjs.org/longport-linux-x64-gnu/-/longport-linux-x64-gnu-3.0.21.tgz | \
    tar -xzf - -O package/longport.linux-x64-gnu.node > \
    node_modules/.pnpm/longport@3.0.21/node_modules/longport/longport.linux-x64-gnu.node && \
    echo "=== 验证 native binding ===" && \
    ls -la node_modules/.pnpm/longport@3.0.21/node_modules/longport/*.node

# 构建后端 TypeScript 代码
RUN pnpm run build

# ============================================
# 阶段 3: 生产运行环境（使用 Ubuntu 24.04 以获取 GLIBC 2.39）
# ============================================
FROM ubuntu:24.04 AS runner

# 配置 apt 使用阿里云镜像源（解决国内网络问题）
RUN sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/ubuntu.sources && \
    sed -i 's/security.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list.d/ubuntu.sources

# 安装 Node.js 20 和运行时依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# 配置 npm 使用淘宝镜像源（解决国内网络问题）
RUN npm config set registry https://registry.npmmirror.com

# 直接用 npm 安装 pnpm（不用 corepack，避免网络问题）
RUN npm install -g pnpm@10.28.2

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

# 下载 native binding 到 longport 主包目录（COPY 可能丢失了这个文件）
RUN curl -sL https://registry.npmjs.org/longport-linux-x64-gnu/-/longport-linux-x64-gnu-3.0.21.tgz | \
    tar -xzf - -O package/longport.linux-x64-gnu.node > \
    /app/api/node_modules/.pnpm/longport@3.0.21/node_modules/longport/longport.linux-x64-gnu.node && \
    chown nodejs:nodejs /app/api/node_modules/.pnpm/longport@3.0.21/node_modules/longport/longport.linux-x64-gnu.node && \
    ls -la /app/api/node_modules/.pnpm/longport@3.0.21/node_modules/longport/*.node

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

# 创建日志目录并设置权限
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

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
