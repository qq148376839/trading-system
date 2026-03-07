import { RagMCP } from './mcp-server';
import { handleIndex } from './api/index-handler';
import { handleQuery } from './api/query-handler';
import { handleDelete } from './api/delete-handler';
import { handleStatus } from './api/status-handler';
import type { Env } from './lib/types';

export { RagMCP };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ─── MCP 端点 ───
    if (path === '/mcp' || path.startsWith('/mcp/')) {
      // 验证 Bearer Token
      if (!verifyAuth(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return RagMCP.serve('/mcp').fetch(request, env, ctx);
    }

    // ─── REST API 端点 ───
    if (path.startsWith('/api/')) {
      // 所有 API 端点需要鉴权
      if (!verifyAuth(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // GET /api/status
      if (path === '/api/status' && request.method === 'GET') {
        return handleStatus(env);
      }

      // POST /api/index
      if (path === '/api/index' && request.method === 'POST') {
        return handleIndex(request, env);
      }

      // DELETE /api/index
      if (path === '/api/index' && request.method === 'DELETE') {
        return handleDelete(request, env);
      }

      // POST /api/query
      if (path === '/api/query' && request.method === 'POST') {
        return handleQuery(request, env);
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // ─── 根路径：健康检查 ───
    if (path === '/' || path === '') {
      return Response.json({
        service: 'rag-server',
        version: '1.0.0',
        endpoints: ['/mcp', '/api/status', '/api/index', '/api/query'],
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};

/** 验证 Bearer Token */
function verifyAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return token === env.API_AUTH_TOKEN;
}
