import type { Plugin, Connect } from 'vite';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function schoolOpsArchivePlugin(): Plugin {
  function attach(middleware: Connect.Server, root: string) {
    middleware.use(async (req: IncomingMessage, res: ServerResponse, next) => {
      if (req.url?.split('?')[0] !== '/api/ops-archive') return next();
      const send = (status: number, data: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !origin || origin !== `http://${host}` || req.headers['x-ops-archive'] !== '1') return send(403, { error: '仅允许本机同源页面归档' });
      if (req.method !== 'POST') return send(405, { error: '使用 POST' });
      try {
        let body = ''; let bytes = 0;
        for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 16 * 1024 * 1024) return send(413, { error: '档案超过 16MB，请联系维护者分批归档' }); body += chunk.toString(); }
        const { studentId, date, envelope } = JSON.parse(body);
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(studentId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(400, { error: '档案标识不合法' });
        const parsedDate = new Date(`${date}T12:00:00`);
        if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return send(400, { error: '日期不合法' });
        const isBase64 = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
        if (envelope?.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 310000 || !isBase64(envelope.salt) || Buffer.from(envelope.salt, 'base64').length !== 16 || !isBase64(envelope.iv) || Buffer.from(envelope.iv, 'base64').length !== 12 || !isBase64(envelope.ciphertext)) return send(400, { error: '只接受有效的加密档案' });
        const dir = path.join(root, '.ops-data', studentId, date); await fs.mkdir(dir, { recursive: true });
        const content = JSON.stringify({ version: envelope.version, algorithm: envelope.algorithm, kdf: envelope.kdf, iterations: envelope.iterations, salt: envelope.salt, iv: envelope.iv, ciphertext: envelope.ciphertext });
        const types = ['daily'];
        if (parsedDate.getDay() === 0) types.push('weekly');
        const tomorrow = new Date(parsedDate); tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.getMonth() !== parsedDate.getMonth()) types.push('monthly');
        for (const type of types) {
          const dest = path.join(dir, `${type}.ops.enc.json`);
          const temp = `${dest}.${crypto.randomUUID()}.tmp`;
          await fs.writeFile(temp, content, { mode: 0o600 }); await fs.rename(temp, dest);
        }
        send(200, { path: dir, types });
      } catch { send(500, { error: '本地归档失败，请检查磁盘空间和文件权限' }); }
    });
  }
  return { name: 'school-ops-archive', configureServer(server) { attach(server.middlewares, server.config.root); }, configurePreviewServer(server) { attach(server.middlewares, server.config.root); } };
}
