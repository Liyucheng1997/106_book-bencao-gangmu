import { readFile, writeFile } from 'node:fs/promises'

type CatalogEntry = { id: string; name: string }
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
const sparqlLiteral = (value: string, language: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@${language}`

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

const requestJson = async (url: URL, attempt = 0): Promise<any> => {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json, application/json' } })
  if ((response.status === 429 || response.status >= 500) && attempt < 7) {
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    await sleep(Math.max(retryAfter * 1000, 2500 * 2 ** attempt))
    return requestJson(url, attempt + 1)
  }
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

const commonsBatch = async (files: string[]) => {
  const result = new Map<string, any>()
  for (const batch of chunk(files, 40)) {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    Object.entries({
      action: 'query', titles: batch.map((file) => `File:${file}`).join('|'), prop: 'imageinfo',
      iiprop: 'url|extmetadata', iiurlwidth: '1000', format: 'json', formatversion: '2', maxlag: '5',
    }).forEach(([key, value]) => url.searchParams.set(key, value))
    const payload = await requestJson(url)
    ;(payload.query?.pages || []).forEach((page: any) => result.set(page.title.replace(/^File:/, ''), page))
    await sleep(900)
  }
  return result
}

const main = async () => {
  const catalog = await readJson<CatalogEntry[]>('data/catalog.json', [])
  const existing = await readJson<MediaMatch[]>('data/media-manifest.json', [])
  const byId = new Map(existing.map((item) => [item.entryId, item]))
  const pending = catalog.filter((entry) => !byId.has(entry.id))
  const batches = chunk(pending, 70)

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const entries = batches[batchIndex]
    const values = entries.flatMap((entry) => [sparqlLiteral(entry.name, 'zh'), sparqlLiteral(entry.name, 'zh-hans')]).join(' ')
    const query = `
      SELECT ?name ?item ?image ?kind WHERE {
        VALUES ?name { ${values} }
        { ?item rdfs:label ?name . BIND("label" AS ?kind) }
        UNION
        { ?item skos:altLabel ?name . BIND("alias" AS ?kind) }
        ?item wdt:P18 ?image .
      }
    `
    const url = new URL('https://query.wikidata.org/sparql')
    url.searchParams.set('query', query)
    url.searchParams.set('format', 'json')
    const payload = await requestJson(url)
    const candidates = new Map<string, Array<{ id: string; file: string; kind: string }>>()
    for (const binding of payload.results?.bindings || []) {
      const name = binding.name.value as string
      const fileUrl = new URL(binding.image.value)
      const file = decodeURIComponent(fileUrl.pathname.split('/').pop() || '').replace(/_/g, ' ')
      const candidate = { id: binding.item.value.split('/').pop(), file, kind: binding.kind.value }
      candidates.set(name, [...(candidates.get(name) || []), candidate])
    }

    const chosen = new Map<string, { id: string; file: string; kind: string }>()
    for (const entry of entries) {
      const unique = [...new Map((candidates.get(entry.name) || []).map((item) => [item.id, item])).values()]
      const labels = unique.filter((item) => item.kind === 'label')
      if (labels.length === 1) chosen.set(entry.id, labels[0])
      else if (unique.length === 1) chosen.set(entry.id, unique[0])
    }
    const mediaPages = await commonsBatch([...new Set([...chosen.values()].map((item) => item.file))])

    for (const entry of entries) {
      const candidate = chosen.get(entry.id)
      const page = candidate ? mediaPages.get(candidate.file) : null
      const info = page?.imageinfo?.[0]
      if (!candidate || !info) continue
      const metadata = info.extmetadata || {}
      byId.set(entry.id, {
        entryId: entry.id,
        name: entry.name,
        status: 'review',
        confidence: 'medium',
        provider: 'Wikimedia Commons',
        wikidataId: candidate.id,
        matchedTitle: candidate.kind === 'label' ? entry.name : `${entry.name}（别名匹配）`,
        imageFileName: candidate.file,
        imageUrl: info.url,
        thumbnailUrl: info.thumburl || info.url,
        sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${candidate.file}`)}`,
        license: stripHtml(metadata.LicenseShortName?.value) || 'See source page',
        licenseUrl: metadata.LicenseUrl?.value,
        artist: stripHtml(metadata.Artist?.value),
        description: stripHtml(metadata.ImageDescription?.value),
        retrievedAt: new Date().toISOString(),
      })
    }
    await writeFile('data/media-manifest.json', `${JSON.stringify([...byId.values()], null, 2)}\n`, 'utf8')
    console.log(`${batchIndex + 1}/${batches.length}：已有图片或候选 ${byId.size}/${catalog.length}`)
    await sleep(1000)
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
