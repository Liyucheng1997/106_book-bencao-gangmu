/* ================================================================
   静态演示后端 —— 本草万象。
   数据（1,712 条目 + 图片清单 + 原典正文）打包为静态 JSON，
   目录筛选 / 排序 / 分页逻辑在浏览器内复刻服务器实现。
   图片批量生成为本地工具链功能，线上只读展示。
   ================================================================ */
(() => {
  'use strict';

  const BASE = '/bencao-wanxiang/';
  const json = (data, status) => new Response(JSON.stringify(data), {
    status: status || 200, headers: { 'Content-Type': 'application/json' }
  });

  const cache = {};
  async function load(name){
    if (!cache[name]) cache[name] = (async () => (await realFetch(BASE + name)).json())();
    return cache[name];
  }

  /* ---- 与 server/index.ts 一致的排序 ---- */
  const categoryOrder = ['water','fire','earth','metal-stone','herb','grain','vegetable','fruit','wood','utensil','insect','scale','shell','bird','beast','human'];
  const zhNums = ['一','二','三','四','五','六','七','八','九','十'];
  const chapterOrder = ch => {
    const n = zhNums.findIndex(v => (ch || '').endsWith('之' + v));
    if (n >= 0) return n + 1;
    if (ch === '雜草' || ch === '杂草') return 99;
    return 0;
  };
  const sortOriginal = (a, b) =>
    categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
    || chapterOrder(a.chapter) - chapterOrder(b.chapter)
    || a.chapterOrder - b.chapterOrder;

  async function handle(url, opts){
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const u = new URL(url, location.href);
    const path = u.pathname.replace(/^.*\/api\//, '/api/');
    const q = u.searchParams;

    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/categories') return json(await load('fx-categories.json'));
    if (path === '/api/stats') return json(await load('fx-stats.json'));
    if (path === '/api/catalog/stats') return json(await load('fx-catalog-stats.json'));
    if (path === '/api/generation/status') return json(await load('fx-generation-status.json'));
    if (path.startsWith('/api/generation'))
      return json({ error: '演示版为只读图鉴 —— 图片批量生成属于本地工具链（Nano Banana + 质检流水线）' }, 403);

    if (path === '/api/catalog'){
      const catalog = [...await load('data/catalog.json')];
      const media = await load('data/media-manifest.json');
      const details = await load('data/catalog-details.json');
      const mediaById = new Map(media.map(m => [m.entryId, m]));
      const sort = q.get('sort') || 'original';
      catalog.sort(sort === 'name'
        ? (a, b) => Number(!/[一-鿿]/.test(a.name)) - Number(!/[一-鿿]/.test(b.name))
          || a.name.localeCompare(b.name, 'zh-CN-u-co-pinyin') || sortOriginal(a, b)
        : sortOriginal);
      const query = (q.get('q') || '').trim().toLowerCase();
      const category = (q.get('category') || '').trim();
      const mediaStatus = (q.get('media') || 'all').trim();
      const page = Math.max(1, Number(q.get('page') || 1));
      const limit = Math.min(60, Math.max(1, Number(q.get('limit') || 24)));
      const filtered = catalog.filter(entry => {
        const status = (mediaById.get(entry.id) || {}).status || 'pending';
        return (!query || (entry.name + ' ' + entry.traditionalName + ' ' + entry.chapter).toLowerCase().includes(query))
          && (!category || category === 'all' || entry.category === category)
          && (mediaStatus === 'all' || status === mediaStatus);
      });
      const start = (page - 1) * limit;
      const data = filtered.slice(start, start + limit).map(entry => ({
        ...entry,
        media: mediaById.get(entry.id) || { status: 'pending', confidence: 'none' },
        summary: (details[entry.id] || {}).summary
      }));
      return json({ data, meta: { total: filtered.length, page, limit, pages: Math.ceil(filtered.length / limit) } });
    }

    const mId = path.match(/^\/api\/catalog\/([^/]+)$/);
    if (mId){
      const catalog = await load('data/catalog.json');
      const media = await load('data/media-manifest.json');
      const details = await load('data/catalog-details.json');
      const entry = catalog.find(item => item.id === decodeURIComponent(mId[1]));
      if (!entry) return json({ error: '未找到该本草条目' }, 404);
      const mediaEntry = media.find(m => m.entryId === entry.id) || { status: 'pending', confidence: 'none' };
      const local = details[entry.id];
      if (local && Array.isArray(local.sections) && local.sections.length)
        return json({ data: { ...entry, media: mediaEntry, sections: local.sections,
          summary: local.summary, sourceUrl: local.sourceUrl, retrievedAt: local.retrievedAt } });
      return json({ error: '该条目的原典正文未包含在演示数据中', sourceUrl: entry.sourceUrl }, 502);
    }

    return json({ error: 'demo: 未实现 ' + path }, 404);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function(input, opts){
    const url = typeof input === 'string' ? input : input.url;
    if (/\/api\//.test(url)) return handle(url, opts || {});
    return realFetch(input, opts);
  };
})();
