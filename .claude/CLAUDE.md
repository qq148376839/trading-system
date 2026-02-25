# Claude Code 错误规则集

> 每条规则来自一次真实犯错，目的是避免重蹈覆辙。

---

## 规则 1：调用需要 cookies 认证的 HTTP 接口，必须使用 Bash + Node.js fetch

**背景**：WebFetch 工具不支持自定义 cookies/headers；Python urllib 会被 Cloudflare 拦截 (403)；curl 在 shell 中处理长 cookie 字符串容易因特殊字符导致参数解析失败。

**正确做法**：使用 `node -e` 执行 Node.js 内置 `fetch`，将 cookies 放在 JS 字符串变量中，同时携带完整的浏览器 headers（User-Agent、sec-ch-ua 等）。

**模板**：
```bash
node -e "
const cookies = '用户提供的完整cookie字符串';
fetch('目标URL', {
  headers: {
    'accept': 'application/json, text/plain, */*',
    'cookie': cookies,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    'Referer': '来源页面URL'
  },
  method: 'GET'
}).then(r => { console.log('Status:', r.status); return r.text(); })
  .then(t => console.log(t))
  .catch(e => console.error('Error:', e));
"
```

**禁止**：
- 不要用 WebFetch 工具（无法传 cookies）
- 不要用 Python urllib/requests（Cloudflare 会 403）
- 不要用 curl 直接拼长 cookie（shell 特殊字符会导致参数解析失败）
