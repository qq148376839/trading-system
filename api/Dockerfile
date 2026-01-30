# API 服务 Dockerfile
# 使用 node:20 (基于 Debian/glibc) 而不是 alpine，因为 longport 包需要 glibc
# longport 包不提供 musl 版本的原生模块
FROM node:20

# 安装运行时依赖和构建工具
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    python3 \
    make \
    g++ \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package.json package-lock.json ./

# 安装所有依赖（包括 devDependencies，用于构建）
RUN npm ci

# 复制源代码
COPY . .

# 构建 TypeScript 代码
RUN npm run build

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

# 健康检查（Debian 镜像已包含 curl）
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# 启动服务
CMD ["npm", "start"]

