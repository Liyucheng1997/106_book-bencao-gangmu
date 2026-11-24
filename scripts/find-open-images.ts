/**
 * 为尚无图片的条目批量寻找开放许可图片（Wikimedia），结果先写入候选文件，人工复核后再 --apply 进 manifest。
 *
 * 阶段：
 *   --stage direct    用原名 / 繁体名批量查中文维基百科条目首图（pageimages，仅自由许可）
 *   --stage identify  对仍无候选的条目，用 DeepSeek 结合《集解》考订现代名称与学名
 *   --stage modern    用考订出的现代中文名、学名查中文 / 英文维基百科首图
 *   --apply           把 data/media-candidates.json 中 accepted !== false 的候选写入 media-manifest.json
 *
 * 每批 50 个标题一个请求，比逐条匹配快两个数量级，也不容易触发限流。
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

type CatalogEntry = { id: string; name: string; traditionalName: string; category: string; chapter: string }
type MediaEntry = { entryId: string; name: string; status: string; rawUrl?: string; provider?: string; [key: string]: unknown }
type Detail = { summary?: string; sections: Array<{ kind: string; original: string }> }

type Candidate = {
  entryId: string
  name: string
  category: string
  identified?: { modernName?: string; latin?: string; kind?: string; confidence?: string; note?: string }
  via?: 'direct' | 'modern-zh' | 'modern-en'
  query?: string
  pageTitle?: string
  pageUrl?: string
  wikidataId?: string
  description?: string
  imageFileName?: string
  thumbnailUrl?: string
  imageUrl?: string
  accepted?: boolean
}

const USER_AGENT = 'BencaoVisualAtlas/0.3 (open media research; educational project)'
const CANDIDATES = 'data/media-candidates.json'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const chunk = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
const stripHtml = (value?: string) => value?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}
const saveJson = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

// 与生图脚本一致：.env.local 覆盖 .env，二者都覆盖 shell 中可能残留的旧变量。
const loadEnv = async () => {
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim())
        if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
      }
    } catch { /* optional */ }
  }
}

const request = async (base: string, params: Record<string, string>, attempt = 0): Promise<any> => {
  const url = new URL(base)
  Object.entries({ ...params, format: 'json', formatversion: '2', maxlag: '5' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } })
  const payload = await response.json().catch(() => null)
  if ((response.status === 429 || response.status >= 500 || payload?.error?.code === 'maxlag') && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    await sleep(Math.max(retryAfter * 1000, 2500 * 2 ** attempt))
    return request(base, params, attempt + 1)
  }
  if (!response.ok || payload?.error) throw new Error(`${response.status} ${payload?.error?.info || url}`)
  return payload
}

type PageHit = { title: string; url: string; wikidataId?: string; description?: string; file: string; thumb: string; original?: string }

/** 批量查维基百科条目首图：返回 查询词 → 命中页。消歧义页与无图页丢弃。 */
const lookupLeadImages = async (lang: 'zh' | 'en', terms: string[]) => {
  const result = new Map<string, PageHit>()
  const api = `https://${lang}.wikipedia.org/w/api.php`
  for (const batch of chunk([...new Set(terms.filter(Boolean))], 50)) {
    const payload = await request(api, {
      action: 'query', titles: batch.join('|'), redirects: '1', converttitles: '1',
      prop: 'pageimages|pageprops|description', piprop: 'thumbnail|name|original', pithumbsize: '500', pilimit: '50',
      ...(lang === 'zh' ? { variant: 'zh-hans' } : {}),
    })
    const query = payload.query || {}
    const hop = (list: any[] | undefined) => new Map<string, string>((list || []).map((item: any) => [item.from, item.to]))
    const normalized = hop(query.normalized)
    const converted = hop(query.converted)
    const redirects = hop(query.redirects)
    const pages = new Map<string, any>((query.pages || []).map((page: any) => [page.title, page]))
    for (const term of batch) {
      let title = normalized.get(term) || term
      title = converted.get(title) || title
      title = redirects.get(title) || title
      const page = pages.get(title)
      if (!page || page.missing || page.pageprops?.disambiguation !== undefined || !page.pageimage || !page.thumbnail) continue
      result.set(term, {
        title: page.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        wikidataId: page.pageprops?.wikibase_item,
        description: page.description,
        file: page.pageimage,
        thumb: page.thumbnail.source,
        original: page.original?.source,
      })
    }
    await sleep(800)
  }
  return result
}

const needsImage = (entry: CatalogEntry, mediaById: Map<string, MediaEntry>) => {
  const media = mediaById.get(entry.id)
  return !media || media.status !== 'matched'
}

const fromHit = (candidate: Candidate, hit: PageHit, via: Candidate['via'], query: string): Candidate => ({
  ...candidate,
  via,
  query,
  pageTitle: hit.title,
  pageUrl: hit.url,
  wikidataId: hit.wikidataId,
  description: hit.description,
  imageFileName: hit.file,
  thumbnailUrl: hit.thumb,
  imageUrl: hit.original || hit.thumb,
})

const stageDirect = async (targets: CatalogEntry[], candidates: Map<string, Candidate>) => {
  const terms = targets.flatMap((entry) => [entry.name, entry.traditionalName])
  const hits = await lookupLeadImages('zh', terms)
  let found = 0
  for (const entry of targets) {
    const term = [entry.name, entry.traditionalName].find((value) => hits.has(value))
    const base: Candidate = candidates.get(entry.id) || { entryId: entry.id, name: entry.name, category: entry.category }
    if (term) { candidates.set(entry.id, fromHit(base, hits.get(term)!, 'direct', term)); found += 1 } else candidates.set(entry.id, base)
  }
  console.log(`direct: ${found}/${targets.length} 有维基条目首图`)
}

/** 考订用文本模型：Gemini（与生图共用 GEMINI_API_KEY），返回 JSON。 */
const callGemini = async (system: string, user: string, attempt = 0): Promise<any> => {
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-flash-latest'
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(process.env.GEMINI_API_KEY) },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
  })
  if (!response.ok) {
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) { await sleep(3000 * (attempt + 1)); return callGemini(system, user, attempt + 1) }
    throw new Error(`Gemini ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const payload = await response.json()
  const text = (payload.candidates?.[0]?.content?.parts || []).map((part: any) => part.text || '').join('')
  return JSON.parse(text || '{}')
}

const stageIdentify = async (targets: CatalogEntry[], candidates: Map<string, Candidate>, details: Record<string, Detail>) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('缺少 GEMINI_API_KEY')
  const todo = targets.filter((entry) => !candidates.get(entry.id)?.thumbnailUrl && !candidates.get(entry.id)?.identified)
  const batches = chunk(todo, 20)
  let cursor = 0
  const worker = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor]
      cursor += 1
      const items = batch.map((entry) => {
        const detail = details[entry.id]
        const form = detail?.sections.find((section) => section.kind === 'form')?.original || ''
        return { id: entry.id, name: entry.name, chapter: entry.chapter, summary: detail?.summary || '', form: form.replace(/\s+/g, ' ').slice(0, 220) }
      })
      let answer: any
      try {
        answer = await callGemini(
          '你是本草考证专家。根据《本草纲目》条目名称、所在部类和原文，考订它对应的现代物种、矿物或物品。只返回 JSON。',
          `对下列条目逐一考订，返回 {"items":[{"id":"...","modernName":"现代通用中文名（维基百科可能使用的条目名，如：肉桂、中华鳖、雄黄、蓝铜矿）","latin":"物种学名或矿物英文名，无则空","kind":"species|mineral|material|object|human|unknown","confidence":"high|medium|low","note":"一句话依据"}]}。无法确定时 confidence=low 并留空 modernName。人部条目 kind=human。\n${JSON.stringify(items)}`,
        )
      } catch (error) {
        console.warn(`identify batch failed: ${String(error)}`)
        continue
      }
      for (const item of answer.items || []) {
        const candidate = candidates.get(item.id)
        if (!candidate) continue
        candidate.identified = { modernName: item.modernName || '', latin: item.latin || '', kind: item.kind, confidence: item.confidence, note: item.note }
      }
      // 每批落盘，中途失败也不丢已考订的结果。
      await saveJson(CANDIDATES, [...candidates.values()])
      console.log(`identify: ${Math.min(cursor * 20, todo.length)}/${todo.length}`)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
}

const stageModern = async (targets: CatalogEntry[], candidates: Map<string, Candidate>) => {
  const open = targets.map((entry) => candidates.get(entry.id)!).filter((candidate) => !candidate.thumbnailUrl && candidate.identified
    && candidate.identified.confidence !== 'low' && candidate.identified.kind !== 'human')
  const zhHits = await lookupLeadImages('zh', open.map((candidate) => candidate.identified!.modernName || ''))
  const enHits = await lookupLeadImages('en', open.map((candidate) => candidate.identified!.latin || ''))
  let found = 0
  for (const candidate of open) {
    const zhTerm = candidate.identified!.modernName || ''
    const enTerm = candidate.identified!.latin || ''
    const hit = zhHits.get(zhTerm) ? ['modern-zh', zhTerm, zhHits.get(zhTerm)] as const : enHits.get(enTerm) ? ['modern-en', enTerm, enHits.get(enTerm)] as const : null
    if (!hit) continue
    candidates.set(candidate.entryId, fromHit(candidate, hit[2]!, hit[0], hit[1]))
    found += 1
  }
  console.log(`modern: ${found}/${open.length} 通过现代名称找到首图`)
}

const stageApply = async (catalog: CatalogEntry[], media: MediaEntry[], candidates: Candidate[]) => {
  const byId = new Map(media.map((item) => [item.entryId, item]))
  const accepted = candidates.filter((candidate) => candidate.thumbnailUrl && candidate.accepted !== false)
  for (const fileBatch of chunk(accepted, 40)) {
    const payload = await request('https://commons.wikimedia.org/w/api.php', {
      action: 'query', titles: fileBatch.map((candidate) => `File:${candidate.imageFileName}`).join('|'),
      prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '500',
    })
    const normalized = new Map<string, string>((payload.query?.normalized || []).map((item: any) => [item.from, item.to]))
    const pages = new Map<string, any>((payload.query?.pages || []).map((page: any) => [page.title, page]))
    for (const candidate of fileBatch) {
      const key = `File:${candidate.imageFileName}`
      const info = pages.get(normalized.get(key) || key)?.imageinfo?.[0]
      const metadata = info?.extmetadata || {}
      const entry = catalog.find((item) => item.id === candidate.entryId)!
      byId.set(candidate.entryId, {
        entryId: candidate.entryId,
        name: entry.name,
        status: 'matched',
        confidence: candidate.via === 'direct' ? 'high' : 'medium',
        provider: 'Wikimedia Commons',
        wikidataId: candidate.wikidataId,
        matchedTitle: candidate.pageTitle,
        identifiedAs: candidate.via === 'direct' ? undefined : [candidate.identified?.modernName, candidate.identified?.latin].filter(Boolean).join(' · '),
        imageFileName: candidate.imageFileName,
        imageUrl: info?.url || candidate.imageUrl,
        thumbnailUrl: info?.thumburl || candidate.thumbnailUrl,
        sourcePage: info?.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(key)}`,
        license: stripHtml(metadata.LicenseShortName?.value) || 'See source page',
        licenseUrl: metadata.LicenseUrl?.value,
        artist: stripHtml(metadata.Artist?.value),
        description: candidate.description,
        retrievedAt: new Date().toISOString(),
      })
    }
    await sleep(800)
  }
  await saveJson('data/media-manifest.json', [...byId.values()])
  console.log(`apply: 写入 ${accepted.length} 条开放图片`)
}

const main = async () => {
  await loadEnv()
  const args = process.argv.slice(2)
  const stage = args[args.indexOf('--stage') + 1]
  const catalog = await readJson<CatalogEntry[]>('data/catalog.json', [])
  const media = await readJson<MediaEntry[]>('data/media-manifest.json', [])
  const mediaById = new Map(media.map((item) => [item.entryId, item]))
  const stored = await readJson<Candidate[]>(CANDIDATES, [])
  const candidates = new Map(stored.map((item) => [item.entryId, item]))

  if (args.includes('--apply')) return stageApply(catalog, media, stored)

  const targets = catalog.filter((entry) => needsImage(entry, mediaById))
  console.log(`待找图条目：${targets.length}`)
  if (stage === 'direct') await stageDirect(targets, candidates)
  else if (stage === 'identify') await stageIdentify(targets, candidates, await readJson('data/catalog-details.json', {}))
  else if (stage === 'modern') await stageModern(targets, candidates)
  else throw new Error('用法：--stage direct|identify|modern，或 --apply')
  await saveJson(CANDIDATES, targets.map((entry) => candidates.get(entry.id)).filter(Boolean))
  if (!existsSync(CANDIDATES)) throw new Error('候选文件写入失败')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
