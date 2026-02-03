# API 服务 Dockerfile
# 使用已有的 node:20 镜像
FROM node:20

# 安装运行时依赖和构建工具
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    python3 \
    make \
    g++ \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 启用 corepack 并激活 pnpm（固定版本，避免 latest 漂移）
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# 设置工作目录
WORKDIR /app

# 仅复制依赖清单（用于 Docker layer 缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

# 按锁文件安装（包含 devDependencies，用于构建）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建 TypeScript 代码
RUN pnpm run build

# 清理构建工具以减小镜像大小
RUN apt-get purge -y python3 make g++ build-essential && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs

# 设置文件权限
RUN chown -R nodejs:nodejs /app

# 切换到非 root 用户
USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# 启动服务
CMD ["node", "conditional-longport.js"]
