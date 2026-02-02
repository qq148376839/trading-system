// 启动前检查 LongPort SDK 可用性
const fs = require('fs');
const path = require('path');

console.log('检查 LongPort SDK 可用性...');

try {
  // 尝试动态加载 longport
  const longport = require('./node_modules/longport');
  console.log('LongPort 模块发现，尝试加载核心组件...');
  
  // 尝试访问核心类
  const { Config, QuoteContext, TradeContext } = longport;
  
  console.log('LongPort SDK 组件加载成功');
  // 如果能成功加载，则继续启动主应用
  require('./dist/server.js');
} catch (error) {
  console.warn('警告：LongPort SDK 加载失败，启用降级模式:', error.message);
  console.warn('系统将以本地模式启动，不支持券商接口功能');
  
  // 设置环境变量告知应用程序使用模拟模式
  process.env.LONGPORT_UNAVAILABLE = 'true';
  
  // 启动主应用
  require('./dist/server.js');
}
