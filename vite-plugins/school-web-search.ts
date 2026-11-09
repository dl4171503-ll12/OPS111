/**
 * 学科资料外网检索：POST /api/school-web-search
 * DeepSeek / Kimi 轮番整理推荐（prefer 由客户端轮换）
 */
import type { Plugin, Connect } from 'vite';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { runCompanionWebSearch } from './web-search-core';

function loadEnvKeys(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function attach(middlewares: Connect.Server, root: string) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] || '';
    if (url !== '/api/school-web-search' || req.method !== 'POST') {
      next();
      return;
    }
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const result = await runCompanionWebSearch({
        query: String(body.query || ''),
        subject: String(body.subject || 'math'),
        kinds: Array.isArray(body.kinds) ? body.kinds : ['web', 'news', 'video', 'wiki'],
        env: { ...process.env, ...loadEnvKeys(root) } as Record<string, string>,
      });
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        items: [],
        error: e instanceof Error ? e.message : 'search proxy error',
      });
    }
  });
}

export function schoolWebSearchPlugin(): Plugin {
  return {
    name: 'school-web-search',
    configureServer(server) {
      attach(server.middlewares, server.config.root);
    },
    configurePreviewServer(server) {
      attach(server.middlewares, server.config.root);
    },
  };
}
