/**
 * AI 调用代理：DeepSeek 主通道 + Kimi K3 备用
 * POST /api/school-llm  { messages, temperature?, max_tokens?, prefer?: 'deepseek'|'kimi'|'auto' }
 */
import type { Plugin, Connect } from 'vite';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

function loadEnv(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
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

async function chat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: unknown[],
  temperature: number,
  max_tokens: number,
) {
  const base = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature, max_tokens, stream: false }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${text.slice(0, 220)}`);
  const data = JSON.parse(text);
  const content = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!content) throw new Error('empty LLM content');
  return content;
}

async function tryDeepSeek(
  env: Record<string, string>,
  messages: unknown[],
  temperature: number,
  max_tokens: number,
) {
  const key = env.DEEPSEEK_API_KEY || env.VITE_DEEPSEEK_API_KEY || '';
  if (!key) throw new Error('no deepseek key');
  const base = env.DEEPSEEK_BASE_URL || env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';
  const content = await chat(base, key, model, messages, temperature, max_tokens);
  return { content, source: 'deepseek', model };
}

async function tryKimiK3(
  env: Record<string, string>,
  messages: unknown[],
  temperature: number,
  max_tokens: number,
) {
  const key =
    env.KIMI_API_KEY || env.MOONSHOT_API_KEY || env.DEEPSEEK_API_KEY_BACKUP || env.DEEPSEEK_BACKUP_KEY || '';
  if (!key) throw new Error('no kimi key');
  const model = env.KIMI_MODEL || env.MOONSHOT_MODEL || 'kimi-k3';
  const bases = [
    env.KIMI_BASE_URL || '',
    env.MOONSHOT_BASE_URL || '',
    'https://api.moonshot.cn/v1',
    'https://api.moonshot.ai/v1',
  ].filter(Boolean);
  const models = [model, 'kimi-k3', 'kimi-k2.5', 'moonshot-v1-32k', 'moonshot-v1-8k'];
  let lastErr = 'unknown';
  for (const base of [...new Set(bases)]) {
    for (const m of [...new Set(models)]) {
      try {
        const content = await chat(base, key, m, messages, temperature, max_tokens);
        return { content, source: 'kimi-k3', model: m };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
  }
  throw new Error(lastErr);
}

function attach(middlewares: Connect.Server, root: string) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] || '';
    if (url !== '/api/school-llm' || req.method !== 'POST') {
      next();
      return;
    }
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const messages = body.messages;
      if (!Array.isArray(messages) || !messages.length) {
        sendJson(res, 400, { error: '缺少 messages' });
        return;
      }
      const env = loadEnv(root);
      const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
      const max_tokens = typeof body.max_tokens === 'number' ? body.max_tokens : 2800;
      const prefer = String(body.prefer || 'auto') as 'deepseek' | 'kimi' | 'auto';
      const errors: string[] = [];

      const order =
        prefer === 'kimi'
          ? (['kimi', 'deepseek'] as const)
          : prefer === 'deepseek'
            ? (['deepseek', 'kimi'] as const)
            : (['deepseek', 'kimi'] as const);

      for (const p of order) {
        try {
          const result =
            p === 'deepseek'
              ? await tryDeepSeek(env, messages, temperature, max_tokens)
              : await tryKimiK3(env, messages, temperature, max_tokens);
          sendJson(res, 200, result);
          return;
        } catch (e) {
          errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      sendJson(res, 502, {
        error: 'AI 服务不可用（DeepSeek 与 Kimi K3 均失败）',
        detail: errors.slice(0, 3).join(' | '),
      });
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : 'school-llm error' });
    }
  });
}

export function schoolLlmPlugin(): Plugin {
  return {
    name: 'school-llm-proxy',
    configureServer(server) {
      attach(server.middlewares, server.config.root);
    },
    configurePreviewServer(server) {
      attach(server.middlewares, server.config.root);
    },
  };
}
