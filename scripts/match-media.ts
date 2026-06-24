import { readFile, writeFile } from 'node:fs/promises'

type CatalogEntry = {
  id: string
  name: string
  traditionalName: string
  category: string
}

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

const WIKIPEDIA_API = 'https://zh.wikipedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'BencaoVisualAtlas/0.2 (open media research; local educational project)'
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const request = async (base: string, params: Record<string, string>, attempt = 0): Promise<any> => {
  const url = new URL(base)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } })
  if ((response.status === 429 || response.status >= 500) && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    await sleep(Math.max(retryAfter * 1000, 1800 * 2 ** attempt))
    return request(base, params, attempt + 1)
  }
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

const stripHtml = (value?: string) => value?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()

const commonsInfo = async (fileName: string) => {
  const result = await request(COMMONS_API, {
    action: 'query',
    titles: `File:${fileName}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1000',
    format: 'json',
    formatversion: '2',
  })
  const page = result.query?.pages?.[0]
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const metadata = info.extmetadata || {}
  return {
    imageFileName: fileName,
    imageUrl: info.url as string,
    thumbnailUrl: (info.thumburl || info.url) as string,
    sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${fileName}`)}`,
    license: stripHtml(metadata.LicenseShortName?.value) || 'See source page',
    licenseUrl: metadata.LicenseUrl?.value as string | undefined,
    artist: stripHtml(metadata.Artist?.value),
    description: stripHtml(metadata.ImageDescription?.value),
  }
}

const wikidataImage = async (wikidataId: string) => {
  const result = await request(WIKIDATA_API, {
    action: 'wbgetentities', ids: wikidataId, props: 'claims', format: 'json',
  })
  const claims = result.entities?.[wikidataId]?.claims
  return claims?.P18?.[0]?.mainsnak?.datavalue?.value as string | undefined
}

const matchWikipedia = async (entry: CatalogEntry): Promise<MediaMatch | null> => {
  const result = await request(WIKIPEDIA_API, {
    action: 'query', titles: entry.name, redirects: '1', converttitles: '1', prop: 'pageprops', format: 'json', formatversion: '2',
  })
  const page = result.query?.pages?.[0]
  const wikidataId = page?.pageprops?.wikibase_item as string | undefined
  if (!page || page.missing || !wikidataId) return null
  const imageFileName = await wikidataImage(wikidataId)
  if (!imageFileName) return null
  const media = await commonsInfo(imageFileName)
  if (!media) return null
  return {
    entryId: entry.id,
    name: entry.name,
    status: 'matched',
    confidence: 'high',
    provider: 'Wikimedia Commons',
    wikidataId,
    matchedTitle: page.title,
    ...media,
    retrievedAt: new Date().toISOString(),
  }
}

const matchWikidata = async (entry: CatalogEntry): Promise<MediaMatch | null> => {
  const result = await request(WIKIDATA_API, {
    action: 'wbsearchentities', search: entry.name, language: 'zh', uselang: 'zh', limit: '6', format: 'json',
  })
  const normalized = entry.name.replace(/\s/g, '')
  const candidate = (result.search || []).find((item: any) => item.label?.replace(/\s/g, '') === normalized)
  if (!candidate) return null
  const imageFileName = await wikidataImage(candidate.id)
  if (!imageFileName) return null
  const media = await commonsInfo(imageFileName)
  if (!media) return null
  return {
    entryId: entry.id,
    name: entry.name,
    status: 'matched',
    confidence: 'high',
    provider: 'Wikimedia Commons',
    wikidataId: candidate.id,
    matchedTitle: candidate.label,
    description: candidate.description || media.description,
    ...media,
    retrievedAt: new Date().toISOString(),
  }
}

const matchCommonsSearch = async (entry: CatalogEntry): Promise<MediaMatch | null> => {
  const result = await request(COMMONS_API, {
    action: 'query', generator: 'search', gsrsearch: `${entry.name} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '1',
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1000', format: 'json', formatversion: '2',
  })
  const page = result.query?.pages?.[0]
  const info = page?.imageinfo?.[0]
  if (!page || !info) return null
  const fileName = page.title.replace(/^File:/, '')
  const metadata = info.extmetadata || {}
  return {
    entryId: entry.id,
    name: entry.name,
    status: 'review',
    confidence: 'medium',
    provider: 'Wikimedia Commons',
    matchedTitle: page.title,
    imageFileName: fileName,
    imageUrl: info.url,
    thumbnailUrl: info.thumburl || info.url,
    sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    license: stripHtml(metadata.LicenseShortName?.value) || 'See source page',
    licenseUrl: metadata.LicenseUrl?.value,
    artist: stripHtml(metadata.Artist?.value),
    description: stripHtml(metadata.ImageDescription?.value),
    retrievedAt: new Date().toISOString(),
  }
}

const matchEntry = async (entry: CatalogEntry): Promise<MediaMatch> => {
  try {
    const wikipedia = await matchWikipedia(entry)
    if (wikipedia) return wikipedia
    const wikidata = await matchWikidata(entry)
    if (wikidata) return wikidata
    const commons = await matchCommonsSearch(entry)
    if (commons) return commons
  } catch (error) {
    console.warn(`${entry.name}: ${String(error)}`)
  }
  return {
    entryId: entry.id,
    name: entry.name,
    status: 'missing',
    confidence: 'none',
    retrievedAt: new Date().toISOString(),
  }
}

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

const main = async () => {
  const catalog = await readJson<CatalogEntry[]>('data/catalog.json', [])
  if (!catalog.length) throw new Error('缺少 data/catalog.json，请先运行 npm run catalog:sync')
  const existing = await readJson<MediaMatch[]>('data/media-manifest.json', [])
  const byId = new Map(existing.map((item) => [item.entryId, item]))
  const all = process.argv.includes('--all')
  const limitArg = process.argv.find((value) => value.startsWith('--limit='))
  const limit = all ? Number.POSITIVE_INFINITY : Number(limitArg?.split('=')[1] || 50)
  const pending = catalog.filter((entry) => !byId.has(entry.id)).slice(0, limit)

  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index]
    const match = await matchEntry(entry)
    byId.set(entry.id, match)
    console.log(`${index + 1}/${pending.length} ${entry.name}: ${match.status}${match.matchedTitle ? ` → ${match.matchedTitle}` : ''}`)
    if ((index + 1) % 10 === 0) {
      await writeFile('data/media-manifest.json', `${JSON.stringify([...byId.values()], null, 2)}\n`, 'utf8')
    }
    await sleep(500)
  }

  const manifest = [...byId.values()]
  await writeFile('data/media-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const report = {
    catalogTotal: catalog.length,
    processed: manifest.length,
    matched: manifest.filter((item) => item.status === 'matched').length,
    review: manifest.filter((item) => item.status === 'review').length,
    missing: manifest.filter((item) => item.status === 'missing').length,
    generatedAt: new Date().toISOString(),
  }
  await writeFile('data/media-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(report)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
