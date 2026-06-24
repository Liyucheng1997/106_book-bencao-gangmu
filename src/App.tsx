import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  BookOpen,
  ChevronRight,
  Compass,
  Layers3,
  Leaf,
  ImageOff,
  LoaderCircle,
  Menu,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import type { CatalogDetail, CatalogEntry, CatalogStats, Category, Stats } from './types'

const fallbackStats: Stats = {
  volumes: 52,
  categories: 16,
  subcategories: 60,
  entries: 1892,
  prescriptions: 11096,
  illustrations: 1160,
  demoEntries: 0,
}

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN').format(value)

const detailKindLabels: Record<string, string> = {
  overview: '原典记述', names: '名称源流', form: '形态与产地', preparation: '采制方法',
  properties: '药性气味', uses: '主治记载', commentary: '历代阐发', prescriptions: '古方辑录', other: '相关记述',
}

function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [stats, setStats] = useState<Stats>(fallbackStats)
  const [selected, setSelected] = useState<CatalogEntry | null>(null)
  const [detail, setDetail] = useState<CatalogDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [catalogStats, setCatalogStats] = useState<CatalogStats>({ total: 0, matched: 0, review: 0, missing: 0, pending: 0 })
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogPages, setCatalogPages] = useState(1)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogCategory, setCatalogCategory] = useState('all')
  const [catalogSort, setCatalogSort] = useState<'original' | 'name'>('original')
  const [catalogLoading, setCatalogLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/categories').then((response) => response.json()),
      fetch('/api/stats').then((response) => response.json()),
    ])
      .then(([categoryResult, statsResult]) => {
        setCategories(categoryResult.data)
        setStats(statsResult.data)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true)
    const params = new URLSearchParams({ page: String(catalogPage), limit: '24', sort: catalogSort })
    if (catalogQuery.trim()) params.set('q', catalogQuery.trim())
    if (catalogCategory !== 'all') params.set('category', catalogCategory)
    Promise.all([
      fetch(`/api/catalog?${params}`, { signal: controller.signal }).then((response) => response.json()),
      fetch('/api/catalog/stats', { signal: controller.signal }).then((response) => response.json()),
    ]).then(([catalogResult, statsResult]) => {
      setCatalog(catalogResult.data || [])
      setCatalogPages(catalogResult.meta?.pages || 1)
      setCatalogStats(statsResult.data)
    }).catch((error) => {
      if (error.name !== 'AbortError') console.error(error)
    }).finally(() => setCatalogLoading(false))
    return () => controller.abort()
  }, [catalogCategory, catalogPage, catalogQuery, catalogSort])

  useEffect(() => {
    document.body.style.overflow = selected ? 'hidden' : ''
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail()
    }
    if (selected) window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selected])

  const scrollToAtlas = () => document.querySelector('#atlas')?.scrollIntoView({ behavior: 'smooth' })

  const openCatalogDetail = (entry: CatalogEntry) => {
    setSelected(entry)
    setDetail(null)
    setDetailError(null)
    fetch(`/api/catalog/${entry.id}`)
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '详情加载失败')
        setDetail(result.data)
      })
      .catch((error) => setDetailError(error.message))
  }

  const closeDetail = () => {
    setSelected(null)
    setDetail(null)
    setDetailError(null)
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="返回首页">
          <span className="brand-seal">本草</span>
          <span className="brand-name">本草万象</span>
        </a>
        <nav className={menuOpen ? 'nav nav-open' : 'nav'}>
          <a href="#taxonomy" onClick={() => setMenuOpen(false)}>纲目分类</a>
          <a href="#atlas" onClick={() => setMenuOpen(false)}>百草图鉴</a>
          <a href="#about" onClick={() => setMenuOpen(false)}>典籍脉络</a>
        </nav>
        <button className="outline-button header-action" onClick={scrollToAtlas}>
          开始寻药 <ArrowRight size={16} />
        </button>
        <button className="menu-button" aria-label="切换导航" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid-lines" />
        <div className="hero-copy">
          <div className="eyebrow"><span /> 东方博物学 · 数字再生</div>
          <h1>循纲阅万物<br /><em>按目识本草</em></h1>
          <p className="hero-lead">把五十二卷典籍，转译为一座可探索的数字本草园。由部入类、以图识药，在古老知识秩序中重新发现自然。</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={scrollToAtlas}>进入百草图鉴 <ArrowRight size={18} /></button>
            <button className="text-button" onClick={() => document.querySelector('#taxonomy')?.scrollIntoView({ behavior: 'smooth' })}>
              浏览十六部 <ArrowDown size={17} />
            </button>
          </div>
          <div className="hero-meta">
            <div><strong>{stats.volumes}</strong><span>卷典籍</span></div>
            <div><strong>{stats.categories}</strong><span>大部类</span></div>
            <div><strong>{formatNumber(stats.entries)}</strong><span>种药物</span></div>
          </div>
        </div>

        <div className="hero-visual" aria-label="人参植物标本图">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="specimen-index">NO. 0001</span>
          <div className="specimen-frame">
            <img src="/herbs/renshen.jpg" alt="人参植物占位图" />
          </div>
          <div className="specimen-card">
            <span>草部 · 山草类</span>
            <strong>人参</strong>
            <i>Panax ginseng</i>
          </div>
          <div className="vertical-inscription">万物有名 · 百草有性</div>
        </div>

        <div className="scroll-cue"><span /> 向下阅览</div>
      </section>

      <section className="taxonomy section-shell" id="taxonomy">
        <div className="section-heading">
          <div>
            <span className="section-number">01</span>
            <span className="kicker">纲举目张</span>
            <h2>十六部，构成一幅<br />古代自然知识地图</h2>
          </div>
          <p>李时珍以“从微至巨、从贱至贵”的秩序统摄万物。数字图谱保留这一分类骨架，并为每一味本草建立可延展的数据节点。</p>
        </div>

        <div className="taxonomy-layout">
          <div className="taxonomy-compass">
            <div className="compass-ring ring-outer" />
            <div className="compass-ring ring-inner" />
            <div className="compass-core">
              <Compass size={28} strokeWidth={1.3} />
              <strong>十六部</strong>
              <span>六十类</span>
            </div>
            {categories.slice(0, 8).map((category, index) => (
              <span key={category.id} className={`compass-label compass-label-${index + 1}`}>{category.mark}</span>
            ))}
          </div>
          <div className="category-list">
            {categories.map((category, index) => (
              <button
                key={category.id}
                className="category-row"
                onClick={() => {
                  setCatalogCategory(category.id)
                  setCatalogPage(1)
                  scrollToAtlas()
                }}
              >
                <span className="category-order">{String(index + 1).padStart(2, '0')}</span>
                <span className="category-mark" style={{ background: category.tone }}>{category.mark}</span>
                <span className="category-title"><strong>{category.name}</strong><small>{category.note}</small></span>
                <span className="category-count">{category.count}<small>种</small></span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </div>
        <p className="data-note">类别数量按维基文库正文二级主条目统计，共 1,712 条；与包含附属药物的“1,892 种”统计口径不同。</p>
      </section>

      <section className="atlas" id="atlas">
        <div className="section-shell">
          <div className="atlas-heading">
            <div>
              <span className="section-number light">02</span>
              <span className="kicker light">百草图鉴</span>
              <h2>循原著次序，观万物本草</h2>
            </div>
            <div className="atlas-progress">
              <strong>{formatNumber(catalogStats.total)}</strong>
              <span>个主条目</span>
              <p>已核验 {catalogStats.matched} · 待复核 {catalogStats.review} · 待处理 {catalogStats.pending}</p>
            </div>
          </div>

          <div className="atlas-toolbar">
            <div className="search-box">
              <Search size={18} />
              <input
                value={catalogQuery}
                onChange={(event) => { setCatalogQuery(event.target.value); setCatalogPage(1) }}
                placeholder="搜索药名或原文章节……"
              />
              {catalogQuery && <button aria-label="清空搜索" onClick={() => { setCatalogQuery(''); setCatalogPage(1) }}><X size={16} /></button>}
            </div>
            <label className="sort-select">
              <span>排序</span>
              <select value={catalogSort} onChange={(event) => { setCatalogSort(event.target.value as 'original' | 'name'); setCatalogPage(1) }}>
                <option value="original">按原著顺序</option>
                <option value="name">按名称拼音</option>
              </select>
            </label>
            <div className="filter-tabs" role="tablist" aria-label="药材分类筛选">
              <button className={catalogCategory === 'all' ? 'active' : ''} onClick={() => { setCatalogCategory('all'); setCatalogPage(1) }}>全部</button>
              {categories.map((category) => (
                <button key={category.id} className={catalogCategory === category.id ? 'active' : ''} onClick={() => { setCatalogCategory(category.id); setCatalogPage(1) }}>
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {catalogLoading ? (
            <div className="loading-state"><Leaf className="loading-leaf" /> 正在翻阅本草……</div>
          ) : catalog.length ? (
            <div className="catalog-grid atlas-catalog-grid">
              {catalog.map((entry) => (
                <button className={`catalog-card atlas-catalog-card status-${entry.media.status}`} key={entry.id} onClick={() => openCatalogDetail(entry)}>
                  <div className="catalog-image">
                    {entry.media.thumbnailUrl ? (
                      <img src={entry.media.thumbnailUrl} alt={`${entry.name}开放素材图`} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                    ) : (
                      <div className="catalog-placeholder"><Leaf size={28} strokeWidth={1.1} /><span>图像整理中</span></div>
                    )}
                    <span className="catalog-status">
                      {entry.media.status === 'matched' ? <><CheckCircle2 size={12} /> 已核验</> : entry.media.status === 'review' ? '待复核' : entry.media.status === 'missing' ? <><ImageOff size={12} /> 缺图</> : '待处理'}
                    </span>
                  </div>
                  <div className="catalog-card-body">
                    <span>{categories.find((category) => category.id === entry.category)?.name} · {entry.chapter}</span>
                    <h3>{entry.name}</h3>
                    <div className="catalog-read-more">
                      阅览原典 <ArrowRight size={14} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state"><Search size={30} /><strong>此处尚无匹配本草</strong><span>换一个名称，或浏览其他部类。</span></div>
          )}

          <div className="catalog-pagination atlas-pagination">
            <button disabled={catalogPage <= 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}>上一页</button>
            <span>第 {catalogPage} / {catalogPages} 页</span>
            <button disabled={catalogPage >= catalogPages} onClick={() => setCatalogPage((page) => Math.min(catalogPages, page + 1))}>下一页</button>
          </div>
          <p className="atlas-data-note">目录来自维基文库《本草纲目》正文主条目。图片优先匹配 Wikimedia Commons；待复核候选不视为最终物种鉴定。</p>
        </div>
      </section>

      <section className="chronicle section-shell" id="about">
        <div className="chronicle-copy">
          <span className="section-number">03</span>
          <span className="kicker">典籍脉络</span>
          <h2>不止是药书，<br />也是一部万物志</h2>
          <p>每个数字条目沿用“释名—集解—修治—气味—主治—发明—附方”的知识层次，既呈现植物形态，也保留古人理解、辨认与使用自然的路径。</p>
          <div className="chronicle-badges">
            <span><BookOpen /> 52 卷原典结构</span>
            <span><Layers3 /> 60 类知识索引</span>
            <span><Sparkles /> 可扩展生成图谱</span>
          </div>
        </div>
        <div className="knowledge-stack">
          {['释名 · 名称源流', '集解 · 产地形态', '修治 · 炮制方法', '气味 · 性味归属', '主治 · 古籍记载', '发明 · 医家阐发', '附方 · 方剂辑录'].map((item, index) => (
            <div key={item} style={{ '--index': index } as React.CSSProperties}><span>{String(index + 1).padStart(2, '0')}</span>{item}</div>
          ))}
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-seal">本草</span><span className="brand-name">本草万象</span></div>
        <p>数字人文原型 · 内容仅用于文化展示与信息设计，不构成医疗建议。</p>
        <span>BENCAO VISUAL ATLAS · 2026</span>
      </footer>

      {selected && (
        <div className="detail-backdrop" role="presentation">
          <article className="detail-view" role="dialog" aria-modal="true" aria-label={`${selected.name}详情`}>
            <aside className="detail-aside">
              <button className="detail-back" onClick={closeDetail} aria-label="返回百草图鉴"><ArrowLeft size={18} /> 返回图鉴</button>
              <div className="detail-image">
                {selected.media.thumbnailUrl ? (
                  <img src={selected.media.thumbnailUrl} alt={selected.name} referrerPolicy="no-referrer" />
                ) : (
                  <div className="detail-image-placeholder"><Leaf size={48} strokeWidth={1} /><span>暂无对应图像</span></div>
                )}
              </div>
              <div className="detail-aside-meta">
                <span>{categories.find((category) => category.id === selected.category)?.name}</span>
                <strong>{selected.chapter}</strong>
                <small>原著次序 · {String(selected.chapterOrder).padStart(2, '0')}</small>
                {selected.media.sourcePage && <a href={selected.media.sourcePage} target="_blank" rel="noreferrer">图片来源与许可 <ArrowRight size={13} /></a>}
              </div>
            </aside>

            <div className="detail-main">
              <header className="detail-header">
                <div>
                  <span>BENCAO ENTRY · {selected.id.slice(-6).toUpperCase()}</span>
                  <h2>{selected.name}</h2>
                  {selected.traditionalName !== selected.name && <p>原文：{selected.traditionalName}</p>}
                </div>
                <button onClick={closeDetail} aria-label="关闭详情"><X /></button>
              </header>

              {detailError ? (
                <div className="detail-error">
                  <ImageOff size={28} />
                  <strong>{detailError}</strong>
                  <p>可先查看维基文库中的原典条目。</p>
                  <a href={`${selected.sourceUrl}#${selected.sourceAnchor}`} target="_blank" rel="noreferrer">打开原典 <ArrowRight size={14} /></a>
                </div>
              ) : !detail ? (
                <div className="detail-loading"><LoaderCircle size={28} /> 正在展开原典条目……</div>
              ) : (
                <div className="detail-sections">
                  {detail.sections.map((section, index) => (
                    <section className={`detail-section kind-${section.kind}`} key={`${section.title}-${index}`}>
                      <div className="detail-section-title">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div><small>{detailKindLabels[section.kind] || '原典记述'}</small><h3>{section.title}</h3></div>
                      </div>
                      <div className="detail-section-copy">
                        {section.content.split(/\n\n+/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                      </div>
                    </section>
                  ))}
                  <footer className="detail-source">
                    <span>内容来源：维基文库《本草纲目》原文结构化整理</span>
                    <a href={detail.sourceUrl} target="_blank" rel="noreferrer">核对原文 <ArrowRight size={14} /></a>
                  </footer>
                </div>
              )}
            </div>
          </article>
        </div>
      )}
    </main>
  )
}

export default App
