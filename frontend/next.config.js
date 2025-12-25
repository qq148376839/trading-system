/** @type {import('next').NextConfig} */
// Windows 兼容性：检测操作系统，在 Windows 上禁用 standalone 输出（避免符号链接权限问题）
// 在 Docker/Linux 环境中，standalone 输出会正常工作
const isWindows = process.platform === 'win32'
const isDocker = process.env.DOCKER_ENV === 'true' || process.env.CI === 'true'

const nextConfig = {
  // 在 Windows 本地开发时禁用 standalone，Docker 构建时启用
  ...(isDocker || !isWindows ? { output: 'standalone' } : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  },
  // Fix for Ant Design module resolution issues
  webpack: (config, { isServer }) => {
    // Ensure proper module resolution
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    
    // Fix for vendor chunks issue
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            default: false,
            vendors: false,
          },
        },
      };
    }
    
    return config;
  },
  // Transpile Ant Design packages
  transpilePackages: ['antd', '@ant-design/icons'],
}

module.exports = nextConfig


