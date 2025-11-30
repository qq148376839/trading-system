import { Xhs } from './xhs.js';

import { handleAnotherApi } from './another.js';

import { hongniuApi } from './hongniuapi.js';

import { imageAiApi } from './imageAI.js';

import { ckApi } from './ckapi.js';

import { moomooApi, moomooApiPost } from './moomooapi.js';

import { tgapi, getExchangeRates, getMessage, setupWebhook, handleUpdate, getRecentGroupMessages  } from './tgapi.js';

import { jiebaCutApi } from './jieba.js';

// 定义路由表

const routes = {

    '/api/xhs': async (request) => {

        const url = new URL(request.url);

        const originalUrl = url.searchParams.get('original_url');

        if (!originalUrl) {

            return new Response('Missing original_url parameter', { status: 400 });

        }

        const xhs = new Xhs(originalUrl);

        try {

            await xhs.getFinalUrl();

            await xhs.getHtmlInitialState();

            const responseData = {

                final_url: xhs.finalUrl,

                data: xhs.data

            };

            return new Response(JSON.stringify(responseData), { headers: { 'Content-Type': 'application/json' } });

        } catch (error) {

            return new Response(JSON.stringify({ error: error.message }), {

                status: 500,

                headers: { 'Content-Type': 'application/json' }

            });

        }

    },

    '/api/another': async (request) => {

        // ✅ 使用 Object.fromEntries 转换查询参数

        const url = new URL(request.url);

        const queryParams = Object.fromEntries(url.searchParams.entries());

        // ✅ 将查询参数传递给 handleAnotherApi

        return handleAnotherApi(queryParams);

    },

    '/api/imageaiapi': async (request) => {

      const url = new URL(request.url);

      const queryParams = Object.fromEntries(url.searchParams.entries());

      return imageAiApi(queryParams);

  },

    '/api/hongniuapi': async (request) => {

        // ✅ 使用 Object.fromEntries 转换查询参数

        const url = new URL(request.url);

        const queryParams = Object.fromEntries(url.searchParams.entries());

        // ✅ 将查询参数传递给 handleAnotherApi

        return hongniuApi(queryParams);

    },

    '/api/ckapi': async (request) => {

        // ✅ 使用 Object.fromEntries 转换查询参数

        const url = new URL(request.url);

        const queryParams = Object.fromEntries(url.searchParams.entries());

        // ✅ 将查询参数传递给 handleAnotherApi

        return ckApi(queryParams);

    },

    '/api/moomooapi': async (request) => {

        // ✅ 使用 Object.fromEntries 转换查询参数

        const url = new URL(request.url);

        const queryParams = Object.fromEntries(url.searchParams.entries());

        // ✅ 将查询参数和原始请求传递给 moomooApi

        return moomooApi(queryParams, request);

    },

    // 新添加的 tgapi 路由

    '/api/tgapi': async (request) => {

        if (request.method !== 'POST') {

            return new Response('Method Not Allowed', { status: 405 });

        }

        try {

            const requestBody = await request.json();

            return tgapi(requestBody);

        } catch (error) {

            return new Response(JSON.stringify({ error: 'Invalid JSON' }), {

                status: 400,

                headers: { 'Content-Type': 'application/json' }

            });

        }

    },

    '/telegram-webhook': async (request) => {

      if (request.method !== 'POST') {

        return new Response('Method Not Allowed', { status: 405 });

      }

  

      try {

        const update = await request.json();

        await handleUpdate(update);

        return new Response('OK', { status: 200 });

      } catch (error) {

        console.error('Error processing webhook:', error);

        return new Response('Internal Server Error', { status: 500 });

      }

    },

    '/api/recent-messages': async (request) => {

      const url = new URL(request.url);

      const chatId = url.searchParams.get('chatId');

      const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    

      if (!chatId) {

        return new Response('Missing chatId parameter', { status: 400 });

      }

    

      return getRecentGroupMessages(parseInt(chatId, 10), limit);

    },

    '/api/jieba':  async (request) => {

      // ✅ 使用 Object.fromEntries 转换查询参数

      const url = new URL(request.url);

      const queryParams = Object.fromEntries(url.searchParams.entries());

      // ✅ 将查询参数传递给 handleAnotherApi

      return jiebaCutApi(queryParams);

  },

    

};

export default {

    async fetch(request, env, ctx) {

        const url = new URL(request.url);

        const pathname = url.pathname;

    

        // 设置 webhook

        if (pathname === '/setup-webhook') {

          const webhookUrl = `${url.origin}/telegram-webhook`;

          try {

            const result = await setupWebhook(webhookUrl);

            return new Response(JSON.stringify(result), {

              headers: { 'Content-Type': 'application/json' }

            });

          } catch (error) {

            return new Response(JSON.stringify({ error: error.message }), {

              status: 500,

              headers: { 'Content-Type': 'application/json' }

            });

          }

        }

    

        const handler = routes[pathname];

        if (handler) {

          return await handler(request);

        }

    

        return new Response('Not Found', { status: 404 });

      },

    async scheduled(controller, env, ctx) {

        

        const data = `

1、本群主要用途用于同事之间投资交流。

2、群里勾搭成功后自行飞书联系【群里会有已离职同事】

3、正直诚信 不坑蒙拐骗

4、不拉公司外人员入内

5、兑换行为及过程群主免责

6、港币/美金汇率参考富途牛牛外汇

7. （2021-3-30）在某公司有员工因赌博输红眼而在他们公司群以换钢笔为由骗取同事30w，所以请大家注意安全

友情提示：股市有风险，谨慎投资，切莫轻信各类荐股信息。

熊猫速汇RMB汇出https://t.me/+xWaE43z_FaRkNGU1

熊猫速汇港币回国https://t.me/+LE1vWD3ZUFY2OTA9

1🍔=1w usd

1✒️=1w hkd

招行汇率：https://m.cmbchina.com/Rate/FxRealrate.aspx

中间价计算方式：(现汇买入+现汇卖出)/2

邀请同事请通过飞书表单https://futu.feishu.cn/share/base/form/shrcn8tefUGIBcu9DyxR1FGMFmc?ccm_open_type=form_v1_link_share

【消息发送模板】

`;

        const Template = `交易方向：收/出

种类： 🍔或✒️

数量：1个

飞书联系方式：飞书英文全称

`;

        const chatId = -1001615502013;

        await getMessage(chatId, data);

        await getMessage(chatId, Template);

        const curno = ['USD', 'HKD'];

        for (const cur of curno) {

            const exchangeData = await getExchangeRates(cur);

            if (exchangeData) {

                await getMessage(chatId, exchangeData);

            }

        }

    },

};

