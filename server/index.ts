import cors from 'cors'
import { load } from 'cheerio'
import express from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { categories, herbs } from './data.js'

const app = express()
const port = Number(process.env.PORT || 8787)

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
  sourcePage?: string
  license?: string
  artist?: string
  matchedTitle?: string
}

const readJson = <T>(path: string, fallback: T): T => {
  try { return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T } catch { return fallback }
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
  const data = filtered.slice(start, start + limit).map((entry) => ({
    ...entry,
    media: mediaById.get(entry.id) || { status: 'pending', confidence: 'none' },
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

app.get('/api/catalog/:id', async (req, res) => {
  const catalog = readJson<CatalogEntry[]>('data/catalog.json', [])
  const media = readJson<MediaEntry[]>('data/media-manifest.json', [])
  const entry = catalog.find((item) => item.id === req.params.id)
  if (!entry) return res.status(404).json({ error: '未找到该本草条目' })
  try {
    const detail = await fetchCatalogDetail(entry)
    return res.json({ data: { ...entry, media: media.find((item) => item.entryId === entry.id) || { status: 'pending', confidence: 'none' }, ...detail } })
  } catch (error) {
    return res.status(502).json({ error: '原典内容暂时无法载入', detail: String(error), sourceUrl: `${entry.sourceUrl}#${entry.sourceAnchor}` })
  }
})

const distPath = resolve(process.cwd(), 'dist')
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
