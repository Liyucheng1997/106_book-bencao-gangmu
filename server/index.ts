import cors from 'cors'
import { load } from 'cheerio'
import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { categories, herbs } from './data.js'

const app = express()
const port = Number(process.env.API_PORT || 8791)

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bencao-api' }))

app.get('/api/categories', (_req, res) => res.json({ data: categories }))

app.get('/api/stats', (_req, res) => {
  res.json({
    data: {
      volumes: 52,
      categories: 16,
      subcategories: 60,
      entries: 1892,
      prescriptions: 11096,
      illustrations: 1160,
      demoEntries: herbs.length,
    },
  })
})

app.get('/api/herbs', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase()
  const category = String(req.query.category || '').trim()
  const result = herbs.filter((herb) => {
    const matchCategory = !category || category === 'all' || herb.category === category
    const haystack = [herb.name, herb.pinyin, herb.latin, herb.subcategory, herb.part, ...herb.tags].join(' ').toLowerCase()
    return matchCategory && (!query || haystack.includes(query))
  })
  res.json({ data: result, meta: { total: result.length } })
})

app.get('/api/herbs/:id', (req, res) => {
  const herb = herbs.find((item) => item.id === req.params.id)
  if (!herb) return res.status(404).json({ error: '未找到该药材' })
  return res.json({ data: herb })
})

type CatalogEntry = {
  id: string
  name: string
  traditionalName: string
  category: string
  chapter: string
  chapterOrder: number
  sourceUrl: string
  sourceAnchor: string
}

type MediaEntry = {
  entryId: string
  status: 'matched' | 'review' | 'missing'
  confidence: 'high' | 'medium' | 'none'
  thumbnailUrl?: string
  imageUrl?: string
  rawUrl?: string
  note?: string
  sourcePage?: string
  license?: string
  artist?: string
  matchedTitle?: string
}

type GenerationStatus = 'idle' | 'running' | 'complete' | 'failed' | 'stopped'

type GenerationJob = {
  id: string
  status: GenerationStatus
  startedAt?: string
  endedAt?: string
  total: number
  completed: number
  succeeded: number
  failed: number
  reused: number
  current?: { id: string; name: string }
  latest?: { id: string; name: string; imageUrl?: string; error?: string }
  model: string
  mode: string
  style?: string
  limit?: number
  category?: string
  overwrite: boolean
  estimatedInputTokens: number
  estimatedImageTokens: number
  estimatedTotalTokens: number
  estimatedStandardUsd: number
  estimatedBatchUsd: number
  totals?: Record<string, number>
  pricing?: Record<string, number>
  logs: string[]
  process?: ChildProcessWithoutNullStreams
}

const readJson = <T>(path: string, fallback: T): T => {
  try { return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T } catch { return fallback }
}

let generationJob: GenerationJob = {
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

const publicJob = () => {
  const { process: _process, ...job } = generationJob
  return job
}

const appendGenerationLog = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return
  generationJob.logs = [...generationJob.logs, trimmed].slice(-80)
}

const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

const applyProgressEvent = (event: Record<string, any>) => {
  if (event.type === 'start') {
    generationJob.total = numberValue(event.total)
    generationJob.estimatedInputTokens = numberValue(event.estimatedInputTokens)
    generationJob.estimatedImageTokens = numberValue(event.estimatedImageTokens)
    generationJob.estimatedTotalTokens = numberValue(event.estimatedTotalTokens)
    generationJob.estimatedStandardUsd = numberValue(event.estimatedStandardUsd)
    generationJob.estimatedBatchUsd = numberValue(event.estimatedBatchUsd)
    generationJob.pricing = event.pricing || generationJob.pricing
  }
  if (event.type === 'entry-start') {
    generationJob.current = { id: String(event.id), name: String(event.name) }
  }
  if (event.type === 'entry-success') {
    generationJob.completed += 1
    generationJob.succeeded += 1
    generationJob.latest = { id: String(event.id), name: String(event.name), imageUrl: String(event.imageUrl || '') }
    generationJob.totals = event.totals || generationJob.totals
  }
  if (event.type === 'entry-reuse') {
    generationJob.completed += 1
    generationJob.reused += 1
    generationJob.latest = { id: String(event.id), name: String(event.name), imageUrl: String(event.imageUrl || '') }
  }
  if (event.type === 'entry-failure') {
    generationJob.completed += 1
    generationJob.failed += 1
    generationJob.latest = { id: String(event.id), name: String(event.name), error: String(event.error || '') }
  }
  if (event.type === 'done') {
    generationJob.totals = event.totals || generationJob.totals
  }
}

const categoryOrder = ['water', 'fire', 'earth', 'metal-stone', 'herb', 'grain', 'vegetable', 'fruit', 'wood', 'utensil', 'insect', 'scale', 'shell', 'bird', 'beast', 'human']
const chineseChapterNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const chapterOrder = (chapter: string) => {
  const number = chineseChapterNumbers.findIndex((value) => chapter.endsWith(`之${value}`))
  if (number >= 0) return number + 1
  if (chapter === '雜草' || chapter === '杂草') return 99
  return 0
}

const sortOriginal = (a: CatalogEntry, b: CatalogEntry) =>
  categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
  || chapterOrder(a.chapter) - chapterOrder(b.chapter)
  || a.chapterOrder - b.chapterOrder

const detailCache = new Map<string, { sections: Array<{ title: string; kind: string; content: string }>; sourceUrl: string; retrievedAt: string }>()

// 本地正文（含 DeepSeek 译文/简介），带 mtime 缓存，脚本更新后自动生效。
type LocalSection = { kind: string; title: string; original: string; translation?: string }
type LocalDetail = { id: string; name: string; sourceUrl: string; retrievedAt: string; summary?: string; sections: LocalSection[] }
let detailsStore: Record<string, LocalDetail> = {}
let detailsMtime = -1
const loadDetailsStore = () => {
  try {
    const stat = statSync('data/catalog-details.json')
    if (stat.mtimeMs !== detailsMtime) {
      detailsStore = JSON.parse(readFileSync('data/catalog-details.json', 'utf8'))
      detailsMtime = stat.mtimeMs
    }
  } catch {
    // 本地正文尚未生成，走实时抓取回退。
  }
  return detailsStore
}

const CANON_KINDS = ['names', 'form', 'preparation', 'properties', 'uses', 'commentary', 'prescriptions'] as const
const CANON_TITLES: Record<string, string> = {
  names: '释名', form: '集解', preparation: '修治', properties: '气味', uses: '主治', commentary: '发明', prescriptions: '附方',
}
// 实时抓取回退时，把解析段归一到固定 7 项（无译文/简介）。
const toCanonicalSections = (sections: Array<{ kind: string; content: string }>): LocalSection[] => {
  const buckets: Record<string, string[]> = { names: [], form: [], preparation: [], properties: [], uses: [], commentary: [], prescriptions: [] }
  for (const section of sections) {
    const kind = section.kind === 'overview' ? 'names' : section.kind === 'other' ? 'commentary' : section.kind
    const content = (section.content || '').trim()
    if (buckets[kind] && content && !buckets[kind].includes(content)) buckets[kind].push(content)
  }
  return CANON_KINDS.map((kind) => ({ kind, title: CANON_TITLES[kind], original: buckets[kind].join('\n\n') }))
}

const sectionKind = (title: string) => {
  if (title.includes('释名') || title.includes('釋名')) return 'names'
  if (title.includes('集解')) return 'form'
  if (title.includes('修治')) return 'preparation'
  if (title.includes('气味') || title.includes('氣味')) return 'properties'
  if (title.includes('主治')) return 'uses'
  if (title.includes('发明') || title.includes('發明')) return 'commentary'
  if (title.includes('附方')) return 'prescriptions'
  return 'other'
}

const fetchCatalogDetail = async (entry: CatalogEntry) => {
  const cached = detailCache.get(entry.id)
  if (cached) return cached
  const pageTitle = decodeURIComponent(new URL(entry.sourceUrl).pathname.replace(/^\/wiki\//, ''))
  const sectionParams = new URLSearchParams({
    action: 'parse', page: pageTitle, prop: 'sections', variant: 'zh-hans', format: 'json', formatversion: '2',
  })
  const headers = { 'User-Agent': 'BencaoVisualAtlas/0.3 (reader; local educational project)' }
  const sectionResponse = await fetch(`https://zh.wikisource.org/w/api.php?${sectionParams}`, { headers })
  if (!sectionResponse.ok) throw new Error(`Wikisource sections: ${sectionResponse.status}`)
  const sectionPayload = await sectionResponse.json() as { parse?: { sections?: Array<{ index: string; anchor: string; line: string }> } }
  const section = sectionPayload.parse?.sections?.find((item) => item.anchor === entry.sourceAnchor || item.line === entry.name)
  if (!section) throw new Error('未在原典页面中定位该条目')

  const contentParams = new URLSearchParams({
    action: 'parse', page: pageTitle, section: section.index, prop: 'text', variant: 'zh-hans', format: 'json', formatversion: '2',
  })
  const contentResponse = await fetch(`https://zh.wikisource.org/w/api.php?${contentParams}`, { headers })
  if (!contentResponse.ok) throw new Error(`Wikisource content: ${contentResponse.status}`)
  const contentPayload = await contentResponse.json() as { parse?: { text?: string } }
  const $ = load(contentPayload.parse?.text || '')
  $('.mw-editsection, .reference, .mw-references-wrap, style, script, table, figure').remove()
  const root = $('.mw-parser-output')
  const parsedSections: Array<{ title: string; kind: string; content: string }> = []
  let current = { title: '原典记述', kind: 'overview', content: '' }
  let currentPart = ''
  const flush = () => {
    if (current.content.trim()) parsedSections.push({ ...current, content: current.content.trim() })
    current = { title: '原典记述', kind: 'overview', content: '' }
  }

  root.find('h3, h4, p, ul, ol, dl').each((_, element) => {
    const tag = element.tagName?.toLowerCase()
    if (/^h[3-4]$/.test(tag || '')) {
      const title = $(element).text().replace(/\[编辑\]/g, '').trim()
      if (title) currentPart = title
      return
    }
    const text = $(element).text().replace(/\s+/g, ' ').trim()
    if (!text) return
    const marker = /【([^】]+)】/g
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = marker.exec(text))) {
      const before = text.slice(cursor, match.index).trim()
      if (before) current.content += `${current.content ? '\n\n' : ''}${before}`
      flush()
      const rawTitle = match[1].trim()
      current = {
        title: currentPart ? `${currentPart} · ${rawTitle}` : rawTitle,
        kind: sectionKind(rawTitle),
        content: '',
      }
      cursor = marker.lastIndex
    }
    const remainder = text.slice(cursor).trim()
    if (remainder) current.content += `${current.content ? '\n\n' : ''}${remainder}`
  })
  flush()

  const detail = { sections: parsedSections, sourceUrl: `${entry.sourceUrl}#${entry.sourceAnchor}`, retrievedAt: new Date().toISOString() }
  detailCache.set(entry.id, detail)
  return detail
}

app.get('/api/catalog', (req, res) => {
  const catalog = readJson<CatalogEntry[]>('data/catalog.json', [])
  const sort = String(req.query.sort || 'original')
  catalog.sort(sort === 'name'
    ? (a, b) => Number(!/[\p{Script=Han}]/u.test(a.name)) - Number(!/[\p{Script=Han}]/u.test(b.name))
      || a.name.localeCompare(b.name, 'zh-CN-u-co-pinyin') || sortOriginal(a, b)
    : sortOriginal)
  const media = readJson<MediaEntry[]>('data/media-manifest.json', [])
  const mediaById = new Map(media.map((item) => [item.entryId, item]))
  const query = String(req.query.q || '').trim().toLowerCase()
  const category = String(req.query.category || '').trim()
  const mediaStatus = String(req.query.media || 'all').trim()
  const page = Math.max(1, Number(req.query.page || 1))
  const limit = Math.min(60, Math.max(1, Number(req.query.limit || 24)))

  const filtered = catalog.filter((entry) => {
    const match = mediaById.get(entry.id)
    const status = match?.status || 'pending'
    return (!query || `${entry.name} ${entry.traditionalName} ${entry.chapter}`.toLowerCase().includes(query))
      && (!category || category === 'all' || entry.category === category)
      && (mediaStatus === 'all' || status === mediaStatus)
  })
  const start = (page - 1) * limit
  const details = loadDetailsStore()
  const data = filtered.slice(start, start + limit).map((entry) => ({
    ...entry,
    media: mediaById.get(entry.id) || { status: 'pending', confidence: 'none' },
    summary: details[entry.id]?.summary,
  }))
  res.json({ data, meta: { total: filtered.length, page, limit, pages: Math.ceil(filtered.length / limit) } })
})

app.get('/api/catalog/stats', (_req, res) => {
  const catalog = readJson<CatalogEntry[]>('data/catalog.json', [])
  const media = readJson<MediaEntry[]>('data/media-manifest.json', [])
  const matched = media.filter((item) => item.status === 'matched').length
  const review = media.filter((item) => item.status === 'review').length
  const missing = media.filter((item) => item.status === 'missing').length
  res.json({ data: { total: catalog.length, matched, review, missing, pending: Math.max(0, catalog.length - media.length) } })
})

app.get('/api/generation/status', (_req, res) => res.json({ data: publicJob() }))

app.post('/api/generation/start', (req, res) => {
  if (generationJob.status === 'running') return res.status(409).json({ error: '已有图片生成任务正在运行', data: publicJob() })
  const mode = ['all', 'unmatched', 'missing', 'pending'].includes(String(req.body?.mode)) ? String(req.body.mode) : 'pending'
  const limit = Math.max(1, Math.min(1712, Number(req.body?.limit || 5)))
  const concurrency = Math.max(1, Math.min(4, Number(req.body?.concurrency || 1)))
  const delayMs = Math.max(0, Number(req.body?.delayMs || 700))
  const category = String(req.body?.category || '').trim()
  const id = String(req.body?.id || '').trim()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((value: unknown) => String(value)).filter(Boolean) : []
  const overwrite = Boolean(req.body?.overwrite)
  const model = String(req.body?.model || 'gemini-3.1-flash-lite-image')
  const style = ['labeled-note', 'classic-page', 'clean-specimen', 'museum-card'].includes(String(req.body?.style)) ? String(req.body.style) : 'labeled-note'
  const jobId = `nano-${Date.now()}`
  const idsFile = ids.length ? resolve(process.cwd(), `data/generation-selection-${jobId}.json`) : undefined
  if (idsFile) writeFileSync(idsFile, `${JSON.stringify(ids, null, 2)}\n`, 'utf8')
  const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
  const args = [
    tsxCli,
    'scripts/generate-nano-banana-images.ts',
    '--progress-json',
    '--mode', mode,
    '--limit', String(limit),
    '--concurrency', String(concurrency),
    '--delay-ms', String(delayMs),
    '--model', model,
    '--style', style,
    '--aspect-ratio', '16:9',
    '--detail-api', `http://127.0.0.1:${port}`,
  ]
  if (idsFile) args.push('--ids-file', idsFile)
  if (category && category !== 'all') args.push('--category', category)
  if (id) args.push('--id', id)
  if (overwrite) args.push('--overwrite')

  generationJob = {
    id: jobId,
    status: 'running',
    startedAt: new Date().toISOString(),
    total: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    reused: 0,
    model,
    style,
    mode,
    limit,
    category: category || undefined,
    overwrite,
    estimatedInputTokens: 0,
    estimatedImageTokens: 0,
    estimatedTotalTokens: 0,
    estimatedStandardUsd: 0,
    estimatedBatchUsd: 0,
    logs: [`启动：node ${args.join(' ')}`],
  }

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    })
  } catch (error) {
    generationJob.status = 'failed'
    generationJob.endedAt = new Date().toISOString()
    appendGenerationLog(error instanceof Error ? error.message : String(error))
    return res.status(500).json({ error: '生成进程启动失败', data: publicJob() })
  }
  generationJob.process = child
  let stdoutBuffer = ''
  let stderrBuffer = ''
  const handleLine = (line: string) => {
    if (line.startsWith('__NANO_PROGRESS__')) {
      try { applyProgressEvent(JSON.parse(line.slice('__NANO_PROGRESS__'.length))) } catch { appendGenerationLog(line) }
      return
    }
    appendGenerationLog(line)
  }
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    lines.forEach(handleLine)
  })
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString()
    const lines = stderrBuffer.split(/\r?\n/)
    stderrBuffer = lines.pop() || ''
    lines.forEach(handleLine)
  })
  child.on('close', (code) => {
    if (stdoutBuffer) handleLine(stdoutBuffer)
    if (stderrBuffer) handleLine(stderrBuffer)
    generationJob.endedAt = new Date().toISOString()
    generationJob.status = generationJob.status === 'stopped' ? 'stopped' : code === 0 ? 'complete' : 'failed'
    appendGenerationLog(`任务结束：exit ${code}`)
    generationJob.process = undefined
  })
  return res.json({ data: publicJob() })
})

app.post('/api/generation/stop', (_req, res) => {
  if (generationJob.status !== 'running' || !generationJob.process) return res.json({ data: publicJob() })
  generationJob.status = 'stopped'
  generationJob.process.kill()
  appendGenerationLog('已请求停止当前生成任务')
  return res.json({ data: publicJob() })
})

app.get('/api/catalog/:id', async (req, res) => {
  const catalog = readJson<CatalogEntry[]>('data/catalog.json', [])
  const media = readJson<MediaEntry[]>('data/media-manifest.json', [])
  const entry = catalog.find((item) => item.id === req.params.id)
  if (!entry) return res.status(404).json({ error: '未找到该本草条目' })
  const mediaEntry = media.find((item) => item.entryId === entry.id) || { status: 'pending', confidence: 'none' }
  const local = loadDetailsStore()[entry.id]
  if (local && Array.isArray(local.sections) && local.sections.length) {
    return res.json({ data: { ...entry, media: mediaEntry, sections: local.sections, summary: local.summary, sourceUrl: local.sourceUrl, retrievedAt: local.retrievedAt } })
  }
  try {
    const detail = await fetchCatalogDetail(entry)
    return res.json({ data: { ...entry, media: mediaEntry, sections: toCanonicalSections(detail.sections), sourceUrl: detail.sourceUrl, retrievedAt: detail.retrievedAt } })
  } catch (error) {
    return res.status(502).json({ error: '原典内容暂时无法载入', detail: String(error), sourceUrl: `${entry.sourceUrl}#${entry.sourceAnchor}` })
  }
})

const distPath = resolve(process.cwd(), 'dist')
const publicPath = resolve(process.cwd(), 'public')
if (existsSync(publicPath)) app.use(express.static(publicPath))
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) return res.sendFile(resolve(distPath, 'index.html'))
    return next()
  })
}

app.listen(port, '127.0.0.1', () => {
  console.log(`本草 API 已运行：http://127.0.0.1:${port}`)
})
