import swaggerJsdoc from 'swagger-jsdoc';
import { version } from '../../package.json';

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
  // 自动扫描路由文件中的注释
  apis: ['./src/routes/*.ts', './src/config/*.ts'], 
};

export const swaggerSpec = swaggerJsdoc(options);

