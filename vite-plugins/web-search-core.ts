/**
 * 外网检索核心（AI一人学校 / 伴读共用）
 * 支持可选 SERPER_API_KEY / TAVILY_API_KEY / BOCHA_API_KEY；否则走免费源。
 */

export type SearchItem = {
  title: string;
  url: string;
  snippet: string;
  source: 'web' | 'news' | 'video' | 'wiki' | 'article';
};

function uniqItems(items: SearchItem[], limit = 12): SearchItem[] {
  const seen = new Set<string>();
  const out: SearchItem[] = [];
  for (const it of items) {
    const key = (it.url || it.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

async function searchSerper(apiKey: string, query: string): Promise<SearchItem[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: 8 }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    news?: Array<{ title?: string; link?: string; snippet?: string }>;
    videos?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  const items: SearchItem[] = [];
  for (const o of data.organic || []) {
    if (o.title && o.link) {
      items.push({ title: o.title, url: o.link, snippet: o.snippet || '', source: 'web' });
    }
  }
  for (const n of data.news || []) {
    if (n.title && n.link) {
      items.push({ title: n.title, url: n.link, snippet: n.snippet || '', source: 'news' });
    }
  }
  for (const v of data.videos || []) {
    if (v.title && v.link) {
      items.push({ title: v.title, url: v.link, snippet: v.snippet || '', source: 'video' });
    }
  }
  return items;
}

async function searchTavily(apiKey: string, query: string): Promise<SearchItem[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: 8,
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results || [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.content || '',
      source: 'web' as const,
    }));
}

async function searchWikipedia(query: string, lang: 'zh' | 'en'): Promise<SearchItem[]> {
  const api = lang === 'zh' ? 'https://zh.wikipedia.org' : 'https://en.wikipedia.org';
  const url =
    `${api}/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    '&limit=5&namespace=0&format=json&origin=*';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = (await res.json()) as [string, string[], string[], string[]];
  const titles = data[1] || [];
  const descs = data[2] || [];
  const links = data[3] || [];
  return titles.map((title, i) => ({
    title,
    url: links[i] || `${api}/wiki/${encodeURIComponent(title)}`,
    snippet: descs[i] || '',
    source: 'wiki' as const,
  }));
}

function parseRssItems(xml: string, source: SearchItem['source']): SearchItem[] {
  const items: SearchItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, 8)) {
    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const link = block.match(/<link>([\s\S]*?)<\/link>/i);
    const desc = block.match(
      /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i,
    );
    const t = (title?.[1] || title?.[2] || '').replace(/<[^>]+>/g, '').trim();
    const u = (link?.[1] || '').trim();
    const s = (desc?.[1] || desc?.[2] || '').replace(/<[^>]+>/g, '').trim().slice(0, 220);
    if (t && u) items.push({ title: t, url: u, snippet: s, source });
  }
  return items;
}

async function searchGoogleNews(query: string, english: boolean): Promise<SearchItem[]> {
  const url = english
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CaiguangAI-Companion/1.0', Accept: 'application/rss+xml,application/xml,text/xml' },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseRssItems(xml, 'news');
}

async function searchDuckDuckGo(query: string): Promise<SearchItem[]> {
  // Instant Answer API（免费，结果偏少但稳定）
  const iaUrl =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    '&format=json&no_html=1&skip_disambig=1';
  const items: SearchItem[] = [];
  try {
    const res = await fetch(iaUrl, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
        Results?: Array<{ Text?: string; FirstURL?: string }>;
      };
      if (data.Heading && data.AbstractURL) {
        items.push({
          title: data.Heading,
          url: data.AbstractURL,
          snippet: data.AbstractText || '',
          source: 'article',
        });
      }
      const pushRel = (t?: { Text?: string; FirstURL?: string }) => {
        if (t?.Text && t?.FirstURL) {
          items.push({ title: t.Text.slice(0, 120), url: t.FirstURL, snippet: t.Text, source: 'web' });
        }
      };
      for (const r of data.Results || []) pushRel(r);
      for (const r of data.RelatedTopics || []) {
        pushRel(r);
        for (const sub of r.Topics || []) pushRel(sub);
      }
    }
  } catch {
    /* ignore */
  }
  return items;
}

function videoSearchLinks(query: string): SearchItem[] {
  const q = encodeURIComponent(query);
  return [
    {
      title: `YouTube 搜索：${query}`,
      url: `https://www.youtube.com/results?search_query=${q}`,
      snippet: '教学视频 / 讲解 / 英文节目检索入口（YouTube）',
      source: 'video',
    },
    {
      title: `Bilibili 搜索：${query}`,
      url: `https://search.bilibili.com/all?keyword=${q}`,
      snippet: '中文教学视频 / 公开课检索入口（B站）',
      source: 'video',
    },
  ];
}

function magazineNewsLinks(query: string, english: boolean): SearchItem[] {
  const q = encodeURIComponent(query);
  if (!english) {
    return [
      {
        title: `Google 新闻：${query}`,
        url: `https://news.google.com/search?q=${q}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
        snippet: '中文新闻报刊聚合检索',
        source: 'news',
      },
    ];
  }
  return [
    {
      title: `BBC / CNN 相关检索：${query}`,
      url: `https://news.google.com/search?q=${q}%20(BBC%20OR%20CNN%20OR%20VOA)&hl=en-US&gl=US&ceid=US:en`,
      snippet: '英文新闻报刊节目聚合（BBC / CNN / VOA 等）',
      source: 'news',
    },
    {
      title: `Google News (EN)：${query}`,
      url: `https://news.google.com/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      snippet: 'English newspapers & broadcast news search',
      source: 'news',
    },
  ];
}

export async function runCompanionWebSearch(opts: {
  query: string;
  subject?: string;
  kinds?: string[];
  env?: Record<string, string>;
}): Promise<{ ok: boolean; items: SearchItem[]; query: string; error?: string }> {
  const query = opts.query.trim();
  if (!query) return { ok: false, items: [], query, error: '搜索词不能为空' };

  const env = opts.env || {};
  const subject = opts.subject || 'chinese';
  const english = subject === 'english' || /[a-zA-Z]{4,}/.test(query);
  const kinds = new Set(opts.kinds?.length ? opts.kinds : ['web', 'news', 'video', 'wiki']);

  const collected: SearchItem[] = [];
  const errors: string[] = [];

  const serper = env.SERPER_API_KEY || env.VITE_SERPER_API_KEY || '';
  const tavily = env.TAVILY_API_KEY || '';
  const bocha = env.BOCHA_API_KEY || '';

  try {
    if (serper && (kinds.has('web') || kinds.has('news') || kinds.has('video'))) {
      collected.push(...(await searchSerper(serper, query)));
    } else if (tavily && kinds.has('web')) {
      collected.push(...(await searchTavily(tavily, query)));
    } else if (bocha && kinds.has('web')) {
      // 博查 OpenAPI（若配置）
      try {
        const res = await fetch('https://api.bochaai.com/v1/web-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bocha}`,
          },
          body: JSON.stringify({ query, count: 8 }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
          };
          for (const v of data.data?.webPages?.value || []) {
            if (v.name && v.url) {
              collected.push({
                title: v.name,
                url: v.url,
                snippet: v.snippet || '',
                source: 'web',
              });
            }
          }
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const tasks: Array<Promise<void>> = [];
  if (kinds.has('wiki')) {
    tasks.push(
      searchWikipedia(query, english ? 'en' : 'zh')
        .then((xs) => {
          collected.push(...xs);
        })
        .catch((e) => {
          errors.push(String(e));
        })
        .then(() => undefined),
    );
    if (english) {
      tasks.push(
        searchWikipedia(query, 'zh')
          .then((xs) => {
            collected.push(...xs);
          })
          .catch(() => undefined)
          .then(() => undefined),
      );
    }
  }
  if (kinds.has('news')) {
    tasks.push(
      searchGoogleNews(query, english)
        .then((xs) => {
          collected.push(...xs);
        })
        .catch((e) => {
          errors.push(String(e));
        })
        .then(() => undefined),
    );
  }
  if (kinds.has('web')) {
    tasks.push(
      searchDuckDuckGo(query)
        .then((xs) => {
          collected.push(...xs);
        })
        .catch((e) => {
          errors.push(String(e));
        })
        .then(() => undefined),
    );
  }
  await Promise.all(tasks);

  // 稳定的视频 / 报刊入口（保证伴读总能给出可点链接）
  if (kinds.has('video')) collected.push(...videoSearchLinks(query));
  if (kinds.has('news')) collected.push(...magazineNewsLinks(query, english));

  const items = uniqItems(collected, 14);
  return {
    ok: items.length > 0,
    items,
    query,
    error: items.length ? undefined : errors.slice(0, 2).join('; ') || '无结果',
  };
}
