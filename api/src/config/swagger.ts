import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { version } from '../../package.json';

// 使用 __dirname 计算路径，确保无论 CWD 是什么都能找到源文件
// 开发模式: __dirname = api/src/config → 扫描 api/src/routes/*.ts
// 生产模式: __dirname = api/dist/config → 扫描 api/dist/routes/*.js（编译后保留JSDoc注释）
const routesDir = path.resolve(__dirname, '../routes');
const configDir = path.resolve(__dirname, '../config');

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
  // 扫描路由和配置文件中的 @openapi 注释
  // 同时匹配 .ts（开发）和 .js（生产编译后），避免路径找不到
  apis: [
    path.join(routesDir, '*.ts'),
    path.join(routesDir, '*.js'),
    path.join(configDir, '*.ts'),
    path.join(configDir, '*.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);






