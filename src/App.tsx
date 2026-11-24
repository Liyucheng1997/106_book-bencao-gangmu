import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  ExternalLink,
  Layers3,
  Leaf,
  ImageOff,
  LoaderCircle,
  Menu,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import type { CatalogDetail, CatalogEntry, CatalogMedia, CatalogStats, Category, GenerationJob, Stats } from './types'

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
const formatUsd = (value?: number) => `$${(value || 0).toFixed(4)}`
const isGeneratedMedia = (media: CatalogMedia) =>
  media.provider === 'Google Gemini API / Nano Banana 2 Lite'
  || Boolean(media.generatedBy)
  || Boolean(media.rawUrl)
  || Boolean(media.thumbnailUrl?.includes('/generated-herbs/'))

/** Wikimedia 缩略图换成指定宽度（只改 /thumb/ 路径；原图链接保持不变）。 */
const sizedThumb = (url: string | undefined, width: number) =>
  url?.replace(/(\/thumb\/.+\/)\d+px-([^/?]+)(\?.*)?$/, `$1${width}px-$2`)

/** 卡片用小图：生成图走 640px WebP，开放图库走 500px 缩略图；详情页才加载原图。 */
const cardImage = (media: CatalogMedia) =>
  (media.thumbnailUrl?.includes('/generated-herbs/thumb/') ? media.thumbnailUrl : media.rawUrl) || sizedThumb(media.thumbnailUrl, 500)
const detailImage = (media: CatalogMedia) => media.rawUrl || sizedThumb(media.thumbnailUrl, 960) || media.imageUrl

/** “蘖米（粟芽、谷芽、麦芽）” → 主名 + 小字补注 */
const splitName = (name: string) => {
  const match = /^(.+?)[（(](.+)[）)]$/.exec(name)
  return match ? { main: match[1], aside: match[2] } : { main: name, aside: '' }
}

const detailKindLabels: Record<string, string> = {
  overview: '原典记述', names: '名称源流', form: '形态与产地', preparation: '采制方法',
  properties: '药性气味', uses: '主治记载', commentary: '历代阐发', prescriptions: '古方辑录', other: '相关记述',
}

const readWorkshopPreference = () => {
  try { return window.localStorage.getItem('bencao-workshop') === 'open' } catch { return false }
}

// 工坊默认参数：只补缺图（pending），单张/当前页由调用处覆盖。
const generationDefaults = { mode: 'pending', limit: 5, concurrency: 1, overwrite: false, style: 'labeled-note' }

const idleGeneration: GenerationJob = {
  id: 'idle',
  status: 'idle',
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  reused: 0,
  model: 'gemini-3.1-flash-lite-image',
  mode: 'pending',
  overwrite: false,
  estimatedInputTokens: 0,
  estimatedImageTokens: 0,
  estimatedTotalTokens: 0,
  estimatedStandardUsd: 0,
  estimatedBatchUsd: 0,
  logs: [],
}

function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [stats, setStats] = useState<Stats>(fallbackStats)
  const [selected, setSelected] = useState<CatalogEntry | null>(null)
  const [detail, setDetail] = useState<CatalogDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [catalogStats, setCatalogStats] = useState<CatalogStats>({ total: 0, matched: 0, review: 0, missing: 0, pending: 0 })
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogPages, setCatalogPages] = useState(1)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogCategory, setCatalogCategory] = useState('all')
  const [catalogSort, setCatalogSort] = useState<'original' | 'name'>('original')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0)
  const [workshopOpen, setWorkshopOpen] = useState(readWorkshopPreference)
  const [generation, setGeneration] = useState<GenerationJob>(idleGeneration)

  useEffect(() => {
    Promise.all([
      fetch('/api/categories').then((response) => response.json()),
      fetch('/api/stats').then((response) => response.json()),
    ])
      .then(([categoryResult, statsResult]) => {
        setCategories(categoryResult.data)
        setStats(statsResult.data)
      })
      .catch((error) => console.error(error))
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem('bencao-workshop', workshopOpen ? 'open' : 'closed') } catch { /* 隐私模式下忽略 */ }
  }, [workshopOpen])

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
      setCatalogPages(Math.max(1, catalogResult.meta?.pages || 1))
      setCatalogTotal(catalogResult.meta?.total || 0)
      setCatalogStats(statsResult.data)
    }).catch((error) => {
      if (error.name !== 'AbortError') console.error(error)
    }).finally(() => setCatalogLoading(false))
    return () => controller.abort()
  }, [catalogCategory, catalogPage, catalogQuery, catalogSort, catalogRefreshKey])

  const fetchGeneration = () => {
    fetch('/api/generation/status')
      .then((response) => response.json())
      .then((result) => {
        setGeneration((previous) => {
          if ((result.data?.completed || 0) > previous.completed) setCatalogRefreshKey(Date.now())
          return result.data || idleGeneration
        })
      })
      .catch((error) => console.error(error))
  }

  useEffect(() => {
    fetchGeneration()
  }, [])

  useEffect(() => {
    if (generation.status !== 'running') return
    const timer = window.setInterval(fetchGeneration, 1500)
    return () => window.clearInterval(timer)
  }, [generation.status])

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

  const scrollToId = (id: string) => {
    setMenuOpen(false)
    document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  const goToPage = (page: number) => {
    setCatalogPage(Math.min(catalogPages, Math.max(1, page)))
    document.querySelector('#atlas-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const chooseCategory = (id: string) => {
    setCatalogCategory(id)
    setCatalogPage(1)
  }

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

  const startGeneration = (options?: { ids?: string[]; id?: string; overwrite?: boolean; limit?: number }) => {
    fetch('/api/generation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: generationDefaults.mode,
        limit: options?.limit ?? generationDefaults.limit,
        concurrency: generationDefaults.concurrency,
        overwrite: options?.overwrite ?? generationDefaults.overwrite,
        category: catalogCategory,
        ids: options?.ids,
        id: options?.id,
        style: generationDefaults.style,
      }),
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '生成任务启动失败')
        setGeneration(result.data)
      })
      .catch((error) => {
        setGeneration((job) => ({ ...job, status: 'failed', logs: [...job.logs, error.message].slice(-80) }))
      })
  }

  const startCurrentPageGeneration = () => {
    startGeneration({ ids: catalog.map((entry) => entry.id), limit: catalog.length, overwrite: false })
  }

  const startEntryGeneration = (entry: CatalogEntry) => {
    startGeneration({ ids: [entry.id], limit: 1, overwrite: isGeneratedMedia(entry.media) })
  }

  const stopGeneration = () => {
    fetch('/api/generation/stop', { method: 'POST' })
      .then((response) => response.json())
      .then((result) => setGeneration(result.data || idleGeneration))
  }

  const generationPercent = generation.total ? Math.round((generation.completed / generation.total) * 100) : 0
  const actualStandardUsd = generation.totals?.standardUsd
  const actualBatchUsd = generation.totals?.batchUsd
  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name || ''
  const activeCategory = categories.find((category) => category.id === catalogCategory)
  const illustrated = catalogStats.matched
  const selectedName = selected ? splitName(selected.name) : null

  return (
    <main>
      <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
        <a className="brand" href="#top" aria-label="返回首页">
          <span className="brand-seal" aria-hidden="true"><b>本</b><b>草</b></span>
          <span className="brand-name">本草万象</span>
        </a>
        <nav className={menuOpen ? 'nav nav-open' : 'nav'}>
          <a href="#taxonomy" onClick={(event) => { event.preventDefault(); scrollToId('#taxonomy') }}>纲目分类</a>
          <a href="#atlas" onClick={(event) => { event.preventDefault(); scrollToId('#atlas') }}>百草图鉴</a>
          <a href="#about" onClick={(event) => { event.preventDefault(); scrollToId('#about') }}>典籍脉络</a>
        </nav>
        <button className="outline-button header-action" onClick={() => scrollToId('#atlas')}>
          开始寻药 <ArrowRight size={15} />
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
            <button className="primary-button" onClick={() => scrollToId('#atlas')}>进入百草图鉴 <ArrowRight size={17} /></button>
            <button className="text-button" onClick={() => scrollToId('#taxonomy')}>
              浏览十六部 <ArrowDown size={16} />
            </button>
          </div>
          <dl className="hero-meta">
            <div><dt>卷典籍</dt><dd>{stats.volumes}</dd></div>
            <div><dt>大部类</dt><dd>{stats.categories}</dd></div>
            <div><dt>正文主条目</dt><dd>{formatNumber(catalogStats.total || 1712)}</dd></div>
          </dl>
        </div>

        <div className="hero-visual" aria-label="人参标本图">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="hero-index">NO. 0001</span>
          <div className="hero-frame">
            <img src={`${import.meta.env.BASE_URL}herbs/renshen.jpg`} alt="人参" />
          </div>
          <div className="hero-label">
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
            <span className="kicker"><span className="section-number">壹</span>纲举目张</span>
            <h2>十六部，构成一幅<br />古代自然知识地图</h2>
          </div>
          <p>李时珍以“从微至巨、从贱至贵”的秩序统摄万物。数字图谱保留这一分类骨架，并为每一味本草建立可延展的数据节点。</p>
        </div>

        <div className="taxonomy-layout">
          <div className="taxonomy-compass">
            <div className="compass-ring ring-outer" />
            <div className="compass-ring ring-ticks" />
            <div className="compass-ring ring-inner" />
            <div className="compass-orbit">
              {categories.slice(0, 8).map((category, index) => (
                <span key={category.id} className="compass-label" style={{ '--i': index } as React.CSSProperties}>
                  <i><b>{category.mark}</b></i>
                </span>
              ))}
            </div>
            <div className="compass-core">
              <Compass size={24} strokeWidth={1.3} />
              <strong>十六部</strong>
              <span>六十类</span>
            </div>
          </div>
          <div className="category-list">
            {categories.map((category, index) => (
              <button
                key={category.id}
                className="category-row"
                onClick={() => {
                  chooseCategory(category.id)
                  scrollToId('#atlas')
                }}
              >
                <span className="category-order">{String(index + 1).padStart(2, '0')}</span>
                <span className="category-mark" style={{ '--tone': category.tone } as React.CSSProperties}>{category.mark}</span>
                <span className="category-title"><strong>{category.name}</strong><small>{category.note}</small></span>
                <span className="category-count">{category.count}<small>种</small></span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
        <p className="data-note">类别数量按维基文库正文二级主条目统计，共 1,712 条；与包含附属药物的“1,892 种”统计口径不同。</p>
      </section>

      <section className="atlas" id="atlas">
        <div className="section-shell atlas-shell">
          <div className="atlas-heading">
            <div>
              <span className="kicker"><span className="section-number">贰</span>百草图鉴</span>
              <h2>循原著次序，观万物本草</h2>
            </div>
            <div className="atlas-progress">
              <div className="atlas-progress-figure">
                <strong>{formatNumber(illustrated)}</strong>
                <span>/ {formatNumber(catalogStats.total)}</span>
              </div>
              <p>条目已配图 · 实物摄影取自 Wikimedia Commons 开放许可图库，余者依原典记述绘制</p>
            </div>
          </div>

          <div className="atlas-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={catalogQuery}
                onChange={(event) => { setCatalogQuery(event.target.value); setCatalogPage(1) }}
                placeholder="检索药名、异名或卷次……"
                aria-label="检索本草"
              />
              {catalogQuery && <button aria-label="清空搜索" onClick={() => { setCatalogQuery(''); setCatalogPage(1) }}><X size={15} /></button>}
            </div>
            <div className="toolbar-side">
              <label className="sort-select">
                <span>排序</span>
                <select value={catalogSort} onChange={(event) => { setCatalogSort(event.target.value as 'original' | 'name'); setCatalogPage(1) }}>
                  <option value="original">按原著次序</option>
                  <option value="name">按名称拼音</option>
                </select>
              </label>
              <button
                className={`workshop-toggle${workshopOpen ? ' active' : ''}`}
                onClick={() => setWorkshopOpen((value) => !value)}
                aria-pressed={workshopOpen}
                title="图像生成与复核工具"
              >
                <Wrench size={14} /> 图像工坊
              </button>
            </div>
            <div className="filter-tabs" role="tablist" aria-label="按部筛选">
              <button role="tab" aria-selected={catalogCategory === 'all'} className={catalogCategory === 'all' ? 'active' : ''} onClick={() => chooseCategory('all')}>全部</button>
              {categories.map((category) => (
                <button role="tab" aria-selected={catalogCategory === category.id} key={category.id} className={catalogCategory === category.id ? 'active' : ''} onClick={() => chooseCategory(category.id)}>
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {workshopOpen && (
            <div className="generation-console">
              <div className="generation-console-main">
                <div className="generation-title">
                  <span><Sparkles size={14} /> Nano Banana 2 Lite</span>
                  <strong>{generation.status === 'running' ? '正在生成本草图像' : generation.status === 'complete' ? '生成任务完成' : generation.status === 'failed' ? '生成任务异常' : generation.status === 'stopped' ? '生成已停止' : '图像生成控制台'}</strong>
                </div>
                <div className="generation-progress-line">
                  <div style={{ width: `${generationPercent}%` }} />
                </div>
                <div className="generation-metrics">
                  <div><strong>{generation.completed}/{generation.total || generationDefaults.limit}</strong><span>进度 {generationPercent}%</span></div>
                  <div><strong>{generation.succeeded}</strong><span>已替换</span></div>
                  <div><strong>{generation.failed}</strong><span>失败</span></div>
                  <div><strong>{formatNumber(generation.totals?.estimatedTotalTokens || generation.estimatedTotalTokens)}</strong><span>估算 token</span></div>
                  <div><strong>{formatUsd(actualStandardUsd ?? generation.estimatedStandardUsd)}</strong><span>标准估算</span></div>
                  <div><strong>{formatUsd(actualBatchUsd ?? generation.estimatedBatchUsd)}</strong><span>批量估算</span></div>
                </div>
                <div className="generation-status-row">
                  <span>{generation.current ? `当前：${generation.current.name}` : generation.latest ? `最新：${generation.latest.name}` : '等待启动'}</span>
                  <span>已核验 {catalogStats.matched} · 待复核 {catalogStats.review} · 缺图 {catalogStats.missing} · 未处理 {catalogStats.pending}</span>
                </div>
              </div>
              <div className="generation-side">
                <div className="generation-preview">
                  {generation.latest?.imageUrl ? <img src={generation.latest.imageUrl} alt={`${generation.latest.name}生成图`} /> : <div><Leaf size={24} /><span>生成后显示最新图片</span></div>}
                </div>
                {generation.status === 'running' ? (
                  <button className="generation-stop" onClick={stopGeneration}>停止生成</button>
                ) : (
                  <button className="generation-start" onClick={startCurrentPageGeneration}>批量生成当前页</button>
                )}
              </div>
            </div>
          )}

          <div className="atlas-summary" id="atlas-grid">
            <span>{activeCategory ? activeCategory.name : '十六部'}{catalogQuery.trim() ? ` · “${catalogQuery.trim()}”` : ''}</span>
            <span>共 {formatNumber(catalogTotal)} 条 · 第 {catalogPage} / {catalogPages} 页</span>
          </div>

          {catalogLoading && !catalog.length ? (
            <div className="loading-state"><Leaf className="loading-leaf" /> 正在翻阅本草……</div>
          ) : catalog.length ? (
            <div className={`specimen-grid${catalogLoading ? ' is-loading' : ''}${workshopOpen ? ' workshop-on' : ''}`}>
              {catalog.map((entry) => {
                const image = cardImage(entry.media)
                const drawn = isGeneratedMedia(entry.media)
                const name = splitName(entry.name)
                return (
                  <article className={`specimen status-${entry.media.status}`} key={entry.id}>
                    <button className="specimen-open" onClick={() => openCatalogDetail(entry)} aria-label={`阅览 ${entry.name}`}>
                      <div className={`specimen-plate ${drawn ? 'is-drawing' : image ? 'is-photo' : 'is-empty'}`}>
                        {image ? (
                          <img
                            src={image}
                            alt={entry.name}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            onError={(event) => { event.currentTarget.parentElement?.classList.add('is-broken') }}
                          />
                        ) : null}
                        <span className="specimen-placeholder"><Leaf size={26} strokeWidth={1.1} /><small>图像整理中</small></span>
                        <span className="specimen-seal" aria-hidden="true">{drawn ? '绘' : '摄'}</span>
                      </div>
                      <div className="specimen-caption">
                        <span className="specimen-meta">
                          {categoryName(entry.category)}
                          {entry.chapter !== categoryName(entry.category) && <><i>·</i>{entry.chapter}</>}
                        </span>
                        <h3>{name.main}{name.aside && <small>{name.aside}</small>}</h3>
                        {(entry.summary || entry.media.note) && <p>{entry.summary || entry.media.note}</p>}
                      </div>
                    </button>
                    {workshopOpen && (
                      <div className="specimen-tools">
                        <span className={`status-chip status-chip-${entry.media.status}`}>
                          {entry.media.status === 'matched' ? '已核验' : entry.media.status === 'review' ? '待复核' : entry.media.status === 'missing' ? '缺图' : '待处理'}
                        </span>
                        <button disabled={generation.status === 'running'} onClick={() => startEntryGeneration(entry)}>
                          {drawn ? '重新生成' : '生成'}
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="empty-state"><Search size={28} /><strong>此处尚无匹配本草</strong><span>换一个名称，或浏览其他部类。</span></div>
          )}

          {catalogPages > 1 && (
            <nav className="pagination" aria-label="分页">
              <button disabled={catalogPage <= 1} onClick={() => goToPage(1)} aria-label="首页"><ChevronsLeft size={16} /></button>
              <button disabled={catalogPage <= 1} onClick={() => goToPage(catalogPage - 1)}><ChevronLeft size={16} /> 上一页</button>
              <span className="pagination-label">
                第
                <input
                  key={catalogPage}
                  type="number"
                  min={1}
                  max={catalogPages}
                  defaultValue={catalogPage}
                  aria-label="跳转页码"
                  onKeyDown={(event) => { if (event.key === 'Enter') goToPage(Number(event.currentTarget.value) || 1) }}
                  onBlur={(event) => { const value = Number(event.currentTarget.value); if (value && value !== catalogPage) goToPage(value) }}
                />
                页 · 共 {catalogPages} 页
              </span>
              <button disabled={catalogPage >= catalogPages} onClick={() => goToPage(catalogPage + 1)}>下一页 <ChevronRight size={16} /></button>
              <button disabled={catalogPage >= catalogPages} onClick={() => goToPage(catalogPages)} aria-label="末页"><ChevronsRight size={16} /></button>
            </nav>
          )}
          <p className="atlas-data-note">目录来自维基文库《本草纲目》正文主条目。“摄”为开放图库实物照片，古今名物对应以考订为准；“绘”为依原典记述生成的示意图，非物种鉴定依据。</p>
        </div>
      </section>

      <section className="chronicle section-shell" id="about">
        <div className="chronicle-copy">
          <span className="kicker"><span className="section-number">叁</span>典籍脉络</span>
          <h2>不止是药书，<br />也是一部万物志</h2>
          <p>每个数字条目沿用“释名—集解—修治—气味—主治—发明—附方”的知识层次，既呈现植物形态，也保留古人理解、辨认与使用自然的路径。</p>
          <div className="chronicle-badges">
            <span><BookOpen /> 52 卷原典结构</span>
            <span><Layers3 /> 60 类知识索引</span>
            <span><Sparkles /> 可扩展生成图谱</span>
          </div>
        </div>
        <ol className="knowledge-stack">
          {['释名', '集解', '修治', '气味', '主治', '发明', '附方'].map((item, index) => (
            <li key={item} style={{ '--index': index } as React.CSSProperties}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item}</strong>
              <small>{['名称源流', '产地形态', '炮制方法', '性味归属', '古籍记载', '医家阐发', '方剂辑录'][index]}</small>
            </li>
          ))}
        </ol>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-seal" aria-hidden="true"><b>本</b><b>草</b></span><span className="brand-name">本草万象</span></div>
        <p>数字人文原型 · 内容仅用于文化展示与信息设计，不构成医疗建议。</p>
        <span>BENCAO VISUAL ATLAS · 2026</span>
      </footer>

      {selected && selectedName && (
        <div className="detail-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeDetail() }}>
          <article className="detail-view" role="dialog" aria-modal="true" aria-label={`${selected.name}详情`}>
            <aside className="detail-aside">
              <button className="detail-back" onClick={closeDetail} aria-label="返回百草图鉴"><ArrowLeft size={16} /> 返回图鉴</button>
              <div className={`detail-image ${isGeneratedMedia(selected.media) ? 'is-drawing' : 'is-photo'}`}>
                {detailImage(selected.media) ? (
                  <img src={detailImage(selected.media)} alt={selected.name} referrerPolicy="no-referrer" />
                ) : (
                  <div className="detail-image-placeholder"><Leaf size={44} strokeWidth={1} /><span>暂无对应图像</span></div>
                )}
              </div>
              <div className="detail-aside-meta">
                <span>{categoryName(selected.category)}{selected.chapter !== categoryName(selected.category) && ` · ${selected.chapter}`}</span>
                <small>原著次序 · 第 {String(selected.chapterOrder).padStart(2, '0')} 条</small>
                <div className="detail-credit">
                  {isGeneratedMedia(selected.media) ? (
                    <p>图：依原典记述绘制的示意图（Gemini Nano Banana），仅供识读参考。</p>
                  ) : selected.media.thumbnailUrl ? (
                    <p>
                      图：{selected.media.artist ? `${selected.media.artist} · ` : ''}{selected.media.license || 'Wikimedia Commons'}
                      {selected.media.identifiedAs && <><br />考订对应：{selected.media.identifiedAs}</>}
                    </p>
                  ) : null}
                  {selected.media.sourcePage && !isGeneratedMedia(selected.media) && (
                    <a href={selected.media.sourcePage} target="_blank" rel="noreferrer">图片来源与许可 <ExternalLink size={12} /></a>
                  )}
                </div>
              </div>
            </aside>

            <div className="detail-main">
              <header className="detail-header">
                <div>
                  <span className="detail-kicker">{categoryName(selected.category)}{selected.chapter !== categoryName(selected.category) && <><i /> {selected.chapter}</>}</span>
                  <h2>{selectedName.main}{selectedName.aside && <small>{selectedName.aside}</small>}</h2>
                  {selected.traditionalName !== selected.name && <p>原文作“{selected.traditionalName}”</p>}
                </div>
                <button onClick={closeDetail} aria-label="关闭详情"><X size={20} /></button>
              </header>

              {detailError ? (
                <div className="detail-error">
                  <ImageOff size={26} />
                  <strong>{detailError}</strong>
                  <p>可先查看维基文库中的原典条目。</p>
                  <a href={`${selected.sourceUrl}#${selected.sourceAnchor}`} target="_blank" rel="noreferrer">打开原典 <ArrowRight size={14} /></a>
                </div>
              ) : !detail ? (
                <div className="detail-loading"><LoaderCircle size={26} /> 正在展开原典条目……</div>
              ) : (
                <div className="detail-sections">
                  {detail.summary && (
                    <div className="detail-summary">
                      <span className="detail-summary-label">提要</span>
                      <p>{detail.summary}</p>
                    </div>
                  )}
                  {detail.sections.map((section) => (
                    <section className={`detail-section kind-${section.kind}${section.original ? '' : ' is-empty'}`} key={section.kind}>
                      <div className="detail-section-title">
                        <h3>{section.title}</h3>
                        <small>{detailKindLabels[section.kind] || '原典记述'}</small>
                      </div>
                      <div className="detail-section-copy">
                        {section.original ? (
                          <>
                            <div className="sec-original">
                              {section.original.split(/\n\n+/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                            </div>
                            {section.translation && (
                              <details className="sec-translation" open>
                                <summary>白话译文</summary>
                                {section.translation.split(/\n\n+/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                              </details>
                            )}
                          </>
                        ) : (
                          <p className="sec-empty">原著未载此项</p>
                        )}
                      </div>
                    </section>
                  ))}
                  <footer className="detail-source">
                    <span>内容来源：维基文库《本草纲目》原文结构化整理</span>
                    <a href={detail.sourceUrl} target="_blank" rel="noreferrer">核对原文 <ExternalLink size={13} /></a>
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
