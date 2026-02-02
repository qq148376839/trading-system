#!/usr/bin/env node

// 检查 LongPort 是否可正常加载
const fs = require('fs');
const path = require('path');

console.log('检查 LongPort SDK 可用性...');

try {
  // 尝试加载 LongPort 模块
  const longport = require('./node_modules/longport');
  
  // 尝试访问核心功能
  const { Config, QuoteContext, TradeContext } = longport;
  
  console.log('LongPort SDK 可用，启动服务器...');
  require('./dist/server.js');
} catch (error) {
  console.warn('警告：LongPort SDK 不可用:', error.message);
  console.warn('系统将以降级模式启动，不支持券商接口功能');
  
  // 设置环境变量以通知应用使用模拟模式
  process.env.LONGPORT_UNAVAILABLE = 'true';
  
  // 启动服务器
  require('./dist/server.js');
}
