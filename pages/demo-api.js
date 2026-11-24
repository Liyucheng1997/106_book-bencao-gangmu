/* ================================================================
   静态演示后端 —— 本草万象（GitHub Pages 用）。
   由 scripts/build-pages.ts 打包：目录、图片清单、简介为小 JSON，
   原典正文按条目拆成 data/details/{id}.json，打开详情时才加载。
   目录筛选 / 排序 / 分页逻辑在浏览器内复刻 server/index.ts。
   图片批量生成为本地工具链功能，线上只读展示。
   ================================================================ */
(() => {
  'use strict';

  /* 站点根路径取自本脚本自身的地址，部署到任何子路径都不用改代码 */
  const BASE = new URL('./', document.currentScript.src).pathname;
  const PREFIX = BASE.replace(/\/$/, '');
  const json = (data, status) => new Response(JSON.stringify(data), {
    status: status || 200, headers: { 'Content-Type': 'application/json' }
  });

  /* 数据里的本地图片路径是站点根目录的绝对路径，补上子路径前缀 */
  const fixPaths = obj => {
    for (const k in obj){
      const v = obj[k];
      if (typeof v === 'string' && /^\/(generated-herbs|herbs)\//.test(v)) obj[k] = PREFIX + v;
      else if (v && typeof v === 'object') fixPaths(v);
    }
    return obj;
  };

  const cache = {};
  function load(name){
    if (!cache[name]) cache[name] = realFetch(BASE + name).then(async response => {
      if (!response.ok) throw new Error(response.status + ' ' + name);
      const data = await response.json();
      return name === 'data/media-manifest.json' ? data.map(fixPaths) : data;
    });
    cache[name].catch(() => delete cache[name]);
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
      const [catalogData, media, summaries] = await Promise.all([
        load('data/catalog.json'), load('data/media-manifest.json'), load('data/summaries.json'),
      ]);
      const catalog = [...catalogData];
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
        summary: summaries[entry.id],
      }));
      return json({ data, meta: { total: filtered.length, page, limit, pages: Math.ceil(filtered.length / limit) } });
    }

    const mId = path.match(/^\/api\/catalog\/([^/]+)$/);
    if (mId){
      const id = decodeURIComponent(mId[1]);
      const [catalog, media] = await Promise.all([load('data/catalog.json'), load('data/media-manifest.json')]);
      const entry = catalog.find(item => item.id === id);
      if (!entry) return json({ error: '未找到该本草条目' }, 404);
      const mediaEntry = media.find(m => m.entryId === entry.id) || { status: 'pending', confidence: 'none' };
      let local = null;
      try { local = await load('data/details/' + encodeURIComponent(id) + '.json'); } catch (error) { /* 无本地正文 */ }
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
