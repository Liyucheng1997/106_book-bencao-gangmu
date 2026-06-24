import { readFile, writeFile } from 'node:fs/promises'

type CatalogEntry = { id: string; name: string; traditionalName: string; category: string }
type MediaMatch = {
  entryId: string
  name: string
  status: 'matched' | 'review' | 'missing'
  confidence: 'high' | 'medium' | 'none'
  provider?: 'Wikimedia Commons'
  wikidataId?: string
  matchedTitle?: string
  imageFileName?: string
  imageUrl?: string
  thumbnailUrl?: string
  sourcePage?: string
  license?: string
  licenseUrl?: string
  artist?: string
  description?: string
  retrievedAt: string
}

const USER_AGENT = 'BencaoVisualAtlas/0.2 (open media research; local educational project)'
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const chunk = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
const stripHtml = (value?: string) => value?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()

const request = async (base: string, params: Record<string, string>, attempt = 0): Promise<any> => {
  const url = new URL(base)
  Object.entries({ ...params, maxlag: '5' }).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } })
  const payload = await response.json().catch(() => null)
  if ((response.status === 429 || response.status >= 500 || payload?.error?.code === 'maxlag') && attempt < 7) {
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    await sleep(Math.max(retryAfter * 1000, 3000 * 2 ** attempt))
    return request(base, params, attempt + 1)
  }
  if (!response.ok || payload?.error) throw new Error(`${response.status} ${payload?.error?.info || url}`)
  return payload
}

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

const main = async () => {
  const catalog = await readJson<CatalogEntry[]>('data/catalog.json', [])
  const existing = await readJson<MediaMatch[]>('data/media-manifest.json', [])
  const byId = new Map(existing.map((item) => [item.entryId, item]))
  const pending = catalog.filter((entry) => !byId.has(entry.id))
  const batches = chunk(pending, 40)

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const entries = batches[batchIndex]
    const wikipedia = await request('https://zh.wikipedia.org/w/api.php', {
      action: 'query', titles: entries.map((entry) => entry.name).join('|'), redirects: '1', converttitles: '1',
      prop: 'pageprops', format: 'json', formatversion: '2',
    })

    const normalized = new Map<string, string>((wikipedia.query?.normalized || []).map((item: any) => [item.from, item.to]))
    const redirects = new Map<string, string>((wikipedia.query?.redirects || []).map((item: any) => [item.from, item.to]))
    const resolveTitle = (title: string) => {
      const normalizedTitle = normalized.get(title) || title
      return redirects.get(normalizedTitle) || normalizedTitle
    }
    const pages = new Map<string, any>((wikipedia.query?.pages || []).map((page: any) => [page.title, page]))
    const qids = [...new Set(entries.map((entry) => pages.get(resolveTitle(entry.name))?.pageprops?.wikibase_item).filter(Boolean))]

    let entities: Record<string, any> = {}
    for (const idBatch of chunk(qids, 50)) {
      const wikidata = await request('https://www.wikidata.org/w/api.php', {
        action: 'wbgetentities', ids: idBatch.join('|'), props: 'claims|descriptions', languages: 'zh|en', format: 'json',
      })
      entities = { ...entities, ...wikidata.entities }
      await sleep(600)
    }

    const files = [...new Set(qids.map((qid) => entities[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value).filter(Boolean))]
    const mediaPages = new Map<string, any>()
    for (const fileBatch of chunk(files, 40)) {
      const commons = await request('https://commons.wikimedia.org/w/api.php', {
        action: 'query', titles: fileBatch.map((file) => `File:${file}`).join('|'), prop: 'imageinfo',
        iiprop: 'url|extmetadata', iiurlwidth: '1000', format: 'json', formatversion: '2',
      })
      ;(commons.query?.pages || []).forEach((page: any) => mediaPages.set(page.title.replace(/^File:/, ''), page))
      await sleep(700)
    }

    for (const entry of entries) {
      const page = pages.get(resolveTitle(entry.name))
      const wikidataId = page?.pageprops?.wikibase_item
      const fileName = entities[wikidataId]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      const mediaPage = mediaPages.get(fileName)
      const info = mediaPage?.imageinfo?.[0]
      if (!wikidataId || !fileName || !info) continue
      const metadata = info.extmetadata || {}
      byId.set(entry.id, {
        entryId: entry.id,
        name: entry.name,
        status: 'matched',
        confidence: 'high',
        provider: 'Wikimedia Commons',
        wikidataId,
        matchedTitle: page.title,
        imageFileName: fileName,
        imageUrl: info.url,
        thumbnailUrl: info.thumburl || info.url,
        sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${fileName}`)}`,
        license: stripHtml(metadata.LicenseShortName?.value) || 'See source page',
        licenseUrl: metadata.LicenseUrl?.value,
        artist: stripHtml(metadata.Artist?.value),
        description: stripHtml(metadata.ImageDescription?.value) || entities[wikidataId]?.descriptions?.zh?.value,
        retrievedAt: new Date().toISOString(),
      })
    }

    await writeFile('data/media-manifest.json', `${JSON.stringify([...byId.values()], null, 2)}\n`, 'utf8')
    console.log(`${batchIndex + 1}/${batches.length}：已匹配 ${byId.size}/${catalog.length}`)
    await sleep(900)
  }

  const manifest = [...byId.values()]
  const report = {
    catalogTotal: catalog.length,
    processed: manifest.length,
    matched: manifest.filter((item) => item.status === 'matched').length,
    review: manifest.filter((item) => item.status === 'review').length,
    missing: manifest.filter((item) => item.status === 'missing').length,
    pending: catalog.length - manifest.length,
    generatedAt: new Date().toISOString(),
  }
  await writeFile('data/media-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(report)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
