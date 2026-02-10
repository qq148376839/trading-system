import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import fs from 'fs';
import { version } from '../../package.json';

// 使用 __dirname 计算路径，确保无论 CWD 是什么都能找到源文件
// 开发模式: __dirname = api/src/config → 扫描 api/src/routes/*.ts
// 生产模式: __dirname = api/dist/config → 扫描 api/dist/routes/*.js（编译后保留JSDoc注释）
const routesDir = path.resolve(__dirname, '../routes');
const configDir = path.resolve(__dirname, '../config');

// glob 在所有平台上都需要正斜杠（Windows 的 path.join 产生反斜杠会导致匹配失败）
const toGlobPath = (p: string) => p.split(path.sep).join('/');

const apiPatterns = [
  toGlobPath(path.join(routesDir, '*.ts')),
  toGlobPath(path.join(routesDir, '*.js')),
  toGlobPath(path.join(configDir, '*.ts')),
  toGlobPath(path.join(configDir, '*.js')),
];

// 启动时诊断：检查目录和文件
console.log('[Swagger] __dirname:', __dirname);
console.log('[Swagger] routesDir:', routesDir);
console.log('[Swagger] apiPatterns:', apiPatterns);
try {
  const routeFiles = fs.readdirSync(routesDir);
  console.log(`[Swagger] routesDir 包含 ${routeFiles.length} 个文件:`, routeFiles.slice(0, 5).join(', '), routeFiles.length > 5 ? '...' : '');
} catch (e: any) {
  console.error(`[Swagger] ⚠️ 无法读取 routesDir: ${e.message}`);
}

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '长桥股票交易系统 API 文档',
      version: version,
      description: '基于 Express + TypeScript 的量化交易系统后端接口文档。\n\n**特性**：\n- 支持 JWT 鉴权\n- 支持在线调试\n- 全中文接口说明',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: '/api',
        description: '当前 API 服务器',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '请输入 Bearer Token 进行鉴权',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: apiPatterns,
};

export const swaggerSpec = swaggerJsdoc(options);

// 启动时诊断：输出解析结果
const pathCount = Object.keys((swaggerSpec as any).paths || {}).length;
console.log(`[Swagger] 解析完成: ${pathCount} 个 API 路径`);
if (pathCount === 0) {
  console.warn('[Swagger] ⚠️ 未发现任何 API 路径！请检查 @openapi 注解和文件路径');
}
