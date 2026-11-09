/**
 * 护眼老师专用后端：搜寻可放映视频 / 眼球训练图，并提供酷狗安静配乐。
 * POST /api/school-eye-care
 * body: { action: 'prepare' | 'kugou', engine?: 'deepseek'|'kimi' }
 */
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runCompanionWebSearch, type SearchItem } from './web-search-core';

type PlayKind = 'video' | 'gallery';

type PlayableVideo = {
  title: string;
  pageUrl: string;
  /** 前端可直接 iframe / video 放映 */
  playUrl: string;
  playType: 'iframe' | 'video';
  source: string;
};

type GalleryImage = {
  title: string;
  url: string;
  source: string;
};

function pluginRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function loadEnv(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of [path.join(root, '.env'), path.join(root, '..', '.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || out[m[1]]) continue;
      out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function extractBvid(url: string): string | null {
  const m = url.match(/\/video\/(BV[\w]+)/i) || url.match(/bvid=(BV[\w]+)/i);
  return m?.[1] || null;
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.replace(/^\//, '') || null;
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/embed\/([\w-]+)/);
      if (m) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function toPlayable(item: SearchItem): PlayableVideo | null {
  const url = item.url || '';
  const bvid = extractBvid(url);
  if (bvid) {
    return {
      title: item.title || `眼保健操 ${bvid}`,
      pageUrl: `https://www.bilibili.com/video/${bvid}`,
      playUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1&danmaku=0&autoplay=1`,
      playType: 'iframe',
      source: 'bilibili',
    };
  }
  const yid = extractYoutubeId(url);
  if (yid) {
    return {
      title: item.title || `Eye care ${yid}`,
      pageUrl: `https://www.youtube.com/watch?v=${yid}`,
      playUrl: `https://www.youtube.com/embed/${yid}?autoplay=1&rel=0`,
      playType: 'iframe',
      source: 'youtube',
    };
  }
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
    return {
      title: item.title || '护眼视频',
      pageUrl: url,
      playUrl: url,
      playType: 'video',
      source: 'direct',
    };
  }
  return null;
}

/** B站开放搜索：拿到真实 BV，才能前端内嵌放映 */
async function searchBilibiliVideos(keyword: string): Promise<PlayableVideo[]> {
  const url =
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video` +
    `&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=12`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 CaiguangAI-EyeCare/1.0',
        Referer: 'https://www.bilibili.com',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { result?: Array<{ bvid?: string; title?: string; description?: string }> };
    };
    const out: PlayableVideo[] = [];
    for (const r of data.data?.result || []) {
      const bvid = String(r.bvid || '').trim();
      if (!bvid) continue;
      const title = String(r.title || '')
        .replace(/<[^>]+>/g, '')
        .trim() || `眼保健操 ${bvid}`;
      out.push({
        title,
        pageUrl: `https://www.bilibili.com/video/${bvid}`,
        playUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1&danmaku=0&autoplay=1`,
        playType: 'iframe',
        source: 'bilibili',
      });
    }
    return out;
  } catch {
    return [];
  }
}

function builtInGallery(root: string): GalleryImage[] {
  const images: GalleryImage[] = [
    { title: '眼球训练 · 左右远眺', url: '/eye-care/eye-train-left-right.svg', source: 'local' },
    { title: '眼球训练 · 上下远眺', url: '/eye-care/eye-train-up-down.svg', source: 'local' },
    { title: '眼球训练 · 顺时针绕圈', url: '/eye-care/eye-train-circle.svg', source: 'local' },
    { title: '眼球训练 · 远近交替', url: '/eye-care/eye-train-near-far.svg', source: 'local' },
    { title: '眼球训练 · 有意识眨眼', url: '/eye-care/eye-train-blink.svg', source: 'local' },
    { title: '眼球训练 · 画∞字', url: '/eye-care/eye-train-figure8.svg', source: 'local' },
  ];
  // 确认本地文件存在；缺失的跳过
  return images.filter((img) => {
    const rel = img.url.replace(/^\//, '');
    return fs.existsSync(path.join(root, 'public', rel));
  });
}

function isLikelyDirectImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(url);
}

async function preparePack(root: string, engine: 'deepseek' | 'kimi') {
  const kind: PlayKind = Math.random() < 0.5 ? 'video' : 'gallery';
  const env = { ...process.env, ...loadEnv(root) } as Record<string, string>;

  if (kind === 'gallery') {
    // 护眼图库只用本地眼球训练示意图，避免视力表/风景图混入
    const gallery = builtInGallery(root);
    const pick =
      gallery[Math.floor(Math.random() * Math.max(1, gallery.length))] || gallery[0];
    return {
      ok: true,
      engine,
      kind: 'gallery' as const,
      summary:
        engine === 'kimi'
          ? 'Kimi 护眼老师为你选好了眼球训练图，请跟着示意图活动眼球、眨眼放松。'
          : 'DeepSeek 护眼老师为你选好了眼球训练图，请跟着示意图活动眼球、眨眼放松。',
      gallery: gallery.slice(0, 8),
      galleryFocus: pick,
      video: null,
    };
  }

  const queries = ['儿童眼保健操 完整版 跟做', '小学生 眼保健操 视频', '眼保健操 教学 儿童'];
  const q = queries[Math.floor(Math.random() * queries.length)];
  const bilibili = await searchBilibiliVideos(q);

  let webPlayables: PlayableVideo[] = [];
  try {
    const searched = await runCompanionWebSearch({
      query: q,
      subject: 'pe',
      kinds: ['video', 'web'],
      env,
    });
    for (const it of searched.items || []) {
      const p = toPlayable(it);
      if (p) webPlayables.push(p);
    }
  } catch {
    /* ignore */
  }

  const pool = [...bilibili, ...webPlayables];
  const uniq = new Map<string, PlayableVideo>();
  for (const v of pool) {
    if (!uniq.has(v.playUrl)) uniq.set(v.playUrl, v);
  }
  const candidates = [...uniq.values()];
  // 搜不到可内嵌视频时，自动改为示例图放映（保证前端一定能播）
  if (!candidates.length) {
    const gallery = builtInGallery(root);
    const pick = gallery[Math.floor(Math.random() * gallery.length)] || gallery[0];
    return {
      ok: true,
      engine,
      kind: 'gallery' as const,
      summary:
        engine === 'kimi'
          ? '暂时搜不到可内嵌的眼保健操视频，Kimi 护眼老师改放眼球训练图，请跟做放松。'
          : '暂时搜不到可内嵌的眼保健操视频，DeepSeek 护眼老师改放眼球训练图，请跟做放松。',
      gallery: gallery.slice(0, 6),
      galleryFocus: pick,
      video: null,
    };
  }

  const video = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    ok: true,
    engine,
    kind: 'video' as const,
    summary:
      engine === 'kimi'
        ? `Kimi 护眼老师已搜到原视频并准备放映：${video.title}`
        : `DeepSeek 护眼老师已搜到原视频并准备放映：${video.title}`,
    gallery: [],
    galleryFocus: null,
    video,
    candidates: candidates.slice(0, 8),
  };
}

type KugouTrack = {
  name: string;
  artist: string;
  hash: string;
  playUrl: string;
};

async function resolveKugouPlayUrl(hash: string): Promise<string | null> {
  const endpoints = [
    `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`,
    `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${hash}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          Referer: 'https://m.kugou.com/',
        },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        url?: string;
        data?: { play_url?: string; play_backup_url?: string };
      };
      const play = data.url || data.data?.play_url || data.data?.play_backup_url;
      if (play && /^https?:\/\//i.test(play)) return play;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function searchKugouQuiet(limit = 4): Promise<KugouTrack[]> {
  const keywords = ['轻音乐 安静', '钢琴 安静 放松', '白噪音 自然', '安静 学习 背景'];
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  const searchUrl =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
    `&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=12`;

  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 CaiguangAI-EyeCare/1.0' },
  });
  if (!res.ok) throw new Error(`酷狗搜索失败 ${res.status}`);
  const data = (await res.json()) as {
    data?: {
      info?: Array<{ songname?: string; singername?: string; hash?: string; '320hash'?: string }>;
    };
  };
  const infos = data.data?.info || [];
  const tracks: KugouTrack[] = [];
  for (const info of infos) {
    if (tracks.length >= limit) break;
    const hash = String(info['320hash'] || info.hash || '').trim();
    if (!hash) continue;
    const playUrl = await resolveKugouPlayUrl(hash);
    if (!playUrl) continue;
    tracks.push({
      name: String(info.songname || '安静轻音乐'),
      artist: String(info.singername || '未知'),
      hash,
      playUrl,
    });
  }
  return tracks;
}

async function handlePost(req: IncomingMessage, res: ServerResponse, root: string) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}') as {
      action?: string;
      engine?: string;
      limit?: number;
    };
    const action = String(body.action || 'prepare');
    const engine = body.engine === 'kimi' ? 'kimi' : 'deepseek';

    if (action === 'kugou') {
      const tracks = await searchKugouQuiet(Math.min(6, Math.max(2, Number(body.limit) || 4)));
      if (!tracks.length) {
        sendJson(res, 502, { ok: false, error: '暂未拿到可播放的酷狗曲目', tracks: [] });
        return;
      }
      sendJson(res, 200, { ok: true, tracks, keywordNote: '安静清静轻音乐' });
      return;
    }

    const pack = await preparePack(root, engine);
    sendJson(res, 200, pack);
  } catch (e) {
    sendJson(res, 500, {
      ok: false,
      error: e instanceof Error ? e.message : 'eye-care prepare failed',
    });
  }
}

function attach(middlewares: Connect.Server, root: string) {
  middlewares.use((req, res, next) => {
    const url = req.url?.split('?')[0] || '';
    if (url !== '/api/school-eye-care') {
      next();
      return;
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'POST only' });
      return;
    }
    void handlePost(req, res, root);
  });
}

export function schoolEyeCarePlugin(): Plugin {
  return {
    name: 'school-eye-care',
    configureServer(server) {
      attach(server.middlewares, server.config.root || pluginRoot());
    },
    configurePreviewServer(server) {
      attach(server.middlewares, server.config.root || pluginRoot());
    },
  };
}
