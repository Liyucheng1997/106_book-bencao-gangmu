/**
 * 抓取《本草纲目》原文并归一化为固定 7 项，落地到 data/catalog-details.json。
 * 7 项：释名(names) 集解(form) 修治(preparation) 气味(properties) 主治(uses) 发明(commentary) 附方(prescriptions)。
 *
 * 关键优化：1712 条只分布在 58 个「部」页面里，故按「页」抓取——每页只请求一次完整正文，
 * 本地按 <h3 id="锚点"> 切出每味药材，再按【标记】切分并归一到 7 项。请求量从 ~3400 降到 58，避免限流。
 *
 * 归并规则：同类多段按原序合并（去重完全相同段）；引言(overview)折进释名；未识别标记(other)折进发明；缺项留空串。
 * 只落原文，译文与简介由 enrich-details-deepseek.ts 填充；本脚本会保留已有译文/简介（原文未变时）。
 *
 * 用法：
 *   npx tsx scripts/sync-catalog-details.ts [--limit N 页] [--only 本草綱目/土部] [--delay 1500] [--overwrite]
 */
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { load } from 'cheerio'

type CatalogEntry = {
  id: string
  name: string
  traditionalName?: string
  category: string
  chapter: string
  sourceUrl: string
  sourceAnchor: string
}

type SectionKind = 'names' | 'form' | 'preparation' | 'properties' | 'uses' | 'commentary' | 'prescriptions'
type StoredSection = { kind: SectionKind; title: string; original: string; translation?: string }
type StoredDetail = { id: string; name: string; sourceUrl: string; retrievedAt: string; summary?: string; sections: StoredSection[] }

const CANON: SectionKind[] = ['names', 'form', 'preparation', 'properties', 'uses', 'commentary', 'prescriptions']
const CANON_TITLE: Record<SectionKind, string> = {
  names: '释名', form: '集解', preparation: '修治', properties: '气味', uses: '主治', commentary: '发明', prescriptions: '附方',
}

const args = process.argv.slice(2)
const readValue = (name: string, fallback: string) => {
  const idx = args.indexOf(name)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  const inline = args.find((a) => a.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}
const limitPages = Number(readValue('--limit', '0'))
const onlyPage = readValue('--only', '')
const perDelay = Number(readValue('--delay', '1500'))
const overwrite = args.includes('--overwrite')

const OUT = 'data/catalog-details.json'
const HEADERS = { 'User-Agent': 'BencaoVisualAtlas/0.4 (educational digital-humanities project; contact tikitaliasrl@gmail.com)' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const saveJson = async (path: string, value: unknown) => {
  const body = `${JSON.stringify(value, null, 2)}\n`
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const tmp = `${path}.tmp-${attempt}`
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, path)
      return
    } catch {
      await sleep(300 * (attempt + 1))
    }
  }
  await writeFile(path, body, 'utf8')
}

const rawSectionKind = (title: string): SectionKind | 'overview' | 'other' => {
  if (title.includes('释名') || title.includes('釋名')) return 'names'
  if (title.includes('集解')) return 'form'
  if (title.includes('修治') || title.includes('修製') || title.includes('炮炙')) return 'preparation'
  if (title.includes('气味') || title.includes('氣味')) return 'properties'
  if (title.includes('主治')) return 'uses'
  if (title.includes('发明') || title.includes('發明')) return 'commentary'
  if (title.includes('附方')) return 'prescriptions'
  return 'other'
}

// 把一味药材的整段正文，按【标记】切成 { kind, content } 段。
const splitByMarkers = (text: string) => {
  const blocks: Array<{ kind: SectionKind | 'overview' | 'other'; content: string }> = []
  let current: { kind: SectionKind | 'overview' | 'other'; content: string } = { kind: 'overview', content: '' }
  const flush = () => {
    if (current.content.trim()) blocks.push({ kind: current.kind, content: current.content.trim() })
    current = { kind: 'overview', content: '' }
  }
  const marker = /【([^】]+)】/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = marker.exec(text))) {
    const before = text.slice(cursor, match.index).trim()
    if (before) current.content += `${current.content ? '\n\n' : ''}${before}`
    flush()
    current = { kind: rawSectionKind(match[1].trim()), content: '' }
    cursor = marker.lastIndex
  }
  const remainder = text.slice(cursor).trim()
  if (remainder) current.content += `${current.content ? '\n\n' : ''}${remainder}`
  flush()
  return blocks
}

const normalize = (blocks: Array<{ kind: SectionKind | 'overview' | 'other'; content: string }>): StoredSection[] => {
  const buckets: Record<SectionKind, string[]> = { names: [], form: [], preparation: [], properties: [], uses: [], commentary: [], prescriptions: [] }
  for (const block of blocks) {
    const kind: SectionKind = block.kind === 'overview' ? 'names' : block.kind === 'other' ? 'commentary' : block.kind
    const content = block.content.trim()
    if (content && !buckets[kind].includes(content)) buckets[kind].push(content)
  }
  return CANON.map((kind) => ({ kind, title: CANON_TITLE[kind], original: buckets[kind].join('\n\n') }))
}

const fetchPageHtml = async (pageTitle: string, attempts = 5): Promise<string | null> => {
  const url = `https://zh.wikisource.org/w/api.php?${new URLSearchParams({
    action: 'parse', page: pageTitle, prop: 'text', variant: 'zh-hans', format: 'json', formatversion: '2',
  })}`
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS })
      if (response.ok) {
        const payload = await response.json() as { parse?: { text?: string } }
        return payload.parse?.text || null
      }
      if (response.status === 429) await sleep(4000 * (attempt + 1)) // 限流：加长退避
    } catch {
      await sleep(1500 * (attempt + 1))
    }
    if (attempt < attempts - 1) await sleep(1000)
  }
  return null
}

// 从整页 HTML 里，按 <h3 id="锚点"> 切出每味药材的正文。
const parsePage = ($: ReturnType<typeof load>, pageEntries: CatalogEntry[]) => {
  // 优先用 sourceAnchor 精确匹配标题 id（同名药材靠 MediaWiki 的 _2 后缀区分，如“柿”与“柿_2”）；
  // 名称仅作兜底，且不覆盖已有锚点，避免重名条目把彼此挤掉。
  const byAnchor = new Map<string, CatalogEntry>()
  const byName = new Map<string, CatalogEntry>()
  for (const entry of pageEntries) {
    byAnchor.set(entry.sourceAnchor, entry)
    if (!byName.has(entry.name)) byName.set(entry.name, entry)
    if (entry.traditionalName && !byName.has(entry.traditionalName)) byName.set(entry.traditionalName, entry)
  }
  const contentById = new Map<string, string>()
  let current: CatalogEntry | null = null
  let currentLevel = 0
  $('.mw-parser-output').find('h2, h3, h4, h5, p, ul, ol, dl').each((_, element) => {
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() || ''
    const headingMatch = /^h([2-5])$/.exec(tag)
    if (headingMatch) {
      const level = Number(headingMatch[1])
      const id = ($(element).attr('id') || '').trim()
      const text = $(element).text().replace(/\s+/g, '').trim()
      const matched = byAnchor.get(id) || byName.get(id) || byName.get(text)
      if (matched) { current = matched; currentLevel = level; return } // 命中药材 → 开始收正文
      // 非药材标题：同级或更高（如“土之一”类目、下一味药材）→ 分隔清空；
      // 更深（如“雨水”下的“立春雨水”子标题）→ 属当前药材，保留继续收（不并入标题文字，避免污染分节）
      if (!current || level <= currentLevel) current = null
      return
    }
    if (!current) return
    const text = $(element).text().replace(/\s+/g, ' ').trim()
    if (text) contentById.set(current.id, `${contentById.has(current.id) ? `${contentById.get(current.id)}\n\n` : ''}${text}`)
  })
  return contentById
}

const main = async () => {
  const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8')) as CatalogEntry[]
  const store: Record<string, StoredDetail> = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {}

  // 按页分组
  const pages = new Map<string, CatalogEntry[]>()
  for (const entry of catalog) {
    const pageTitle = decodeURIComponent(new URL(entry.sourceUrl).pathname.replace(/^\/wiki\//, ''))
    if (onlyPage && pageTitle !== onlyPage) continue
    if (!pages.has(pageTitle)) pages.set(pageTitle, [])
    pages.get(pageTitle)!.push(entry)
  }
  let pageList = [...pages.entries()]
  if (!overwrite) pageList = pageList.filter(([, entries]) => entries.some((e) => !store[e.id]))
  if (limitPages > 0) pageList = pageList.slice(0, limitPages)

  console.log(`共 ${pages.size} 页，本次处理 ${pageList.length} 页`)
  let okEntries = 0
  let pageIndex = 0
  for (const [pageTitle, pageEntries] of pageList) {
    pageIndex += 1
    const html = await fetchPageHtml(pageTitle)
    if (!html) { console.log(`  [${pageIndex}/${pageList.length}] ${pageTitle} 抓取失败，跳过`); await sleep(perDelay); continue }
    const $ = load(html)
    $('.mw-editsection, .reference, .mw-references-wrap, style, script, table, figure').remove()
    const contentById = parsePage($, pageEntries)
    let pageOk = 0
    for (const entry of pageEntries) {
      const content = contentById.get(entry.id)
      if (!content) continue
      const sections = normalize(splitByMarkers(content))
      const prev = store[entry.id]
      let allSame = Boolean(prev)
      if (prev) {
        for (const section of sections) {
          const prevSection = prev.sections?.find((p) => p.kind === section.kind)
          if (prevSection && prevSection.original === section.original) {
            if (prevSection.translation) section.translation = prevSection.translation
          } else {
            allSame = false
          }
        }
      }
      store[entry.id] = {
        id: entry.id,
        name: entry.name,
        sourceUrl: `${entry.sourceUrl}#${entry.sourceAnchor}`,
        retrievedAt: new Date().toISOString(),
        summary: allSame ? prev?.summary : undefined,
        sections,
      }
      pageOk += 1
      okEntries += 1
    }
    await saveJson(OUT, store)
    console.log(`  [${pageIndex}/${pageList.length}] ${pageTitle}：${pageOk}/${pageEntries.length} 味`)
    await sleep(perDelay)
  }
  console.log(`完成。本次落地 ${okEntries} 味，累计 ${Object.keys(store).length} 条。`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
