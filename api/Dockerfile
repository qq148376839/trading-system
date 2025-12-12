# API 服务 Dockerfile
FROM node:20-alpine

# 安装构建依赖（用于编译原生模块，如 bcrypt）
# 安装 curl 和 pnpm
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl && \
    npm install -g pnpm

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 pnpm-lock.yaml
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# 安装所有依赖（包括 devDependencies，用于构建）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建 TypeScript 代码
RUN pnpm run build

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

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
CMD ["pnpm", "start"]

