/**
 * 给已生成的条目补齐 rawUrl（无字原图）与 note（古籍代表句），写回 media-manifest.json。
 * 题签标题+说明改由前端叠加，本脚本不再调用图像 API，只读取原文分节提取一句代表句。
 *
 * 用法：
 *   npx tsx scripts/backfill-plate-notes.ts [--detail-api http://127.0.0.1:8791] [--concurrency 5] [--overwrite-note]
 */
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 原子写：先写临时文件再 rename，并对 Windows 文件占用重试，避免与 dev API 的读并发冲突。
const saveJson = async (path: string, value: unknown) => {
  const body = `${JSON.stringify(value, null, 2)}\n`
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const tmp = `${path}.tmp-${attempt}`
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, path)
      return
    } catch {
      await sleepMs(300 * (attempt + 1))
    }
  }
  // 最后一次直接写，失败则抛出。
  await writeFile(path, body, 'utf8')
}

type CatalogEntry = {
  id: string
  name: string
  traditionalName: string
  category: string
  chapter: string
}

type MediaEntry = {
  entryId: string
  name?: string
  provider?: string
  thumbnailUrl?: string
  imageUrl?: string
  rawUrl?: string
  note?: string
  generatedBy?: unknown
  [key: string]: unknown
}

type DetailSection = { title: string; kind: string; content: string }

const args = process.argv.slice(2)
const readValue = (name: string, fallback: string) => {
  const idx = args.indexOf(name)
  if (idx >= 0 && args[idx + 1]) return args[idx + 1]
  const inline = args.find((a) => a.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}
const detailApi = readValue('--detail-api', 'http://127.0.0.1:8791').replace(/\/+$/, '')
const concurrency = Math.max(1, Number(readValue('--concurrency', '5')))
const overwriteNote = args.includes('--overwrite-note')

const OUTPUT_DIR = 'public/generated-herbs'
const RAW_EXTS = ['jpg', 'png', 'webp'] as const

const isGenerated = (item: MediaEntry) =>
  item.provider === 'Google Gemini API / Nano Banana 2 Lite'
  || Boolean(item.generatedBy)
  || Boolean(item.thumbnailUrl?.startsWith('/generated-herbs/'))

const safeText = (value: string) => value.replace(/\s+/g, ' ').trim()

// 从一段原文里抽出一句“最有代表性”的短句：去掉注家称谓/括注，取首句，控制在 24 字内。
const ancientNote = (value: string) => {
  const cleaned = safeText(value)
    .replace(/^（[^）]{1,12}）[︰:：]/, '')
    .replace(/^[^︰:：]{1,12}[曰云][︰:：]/, '')
    .replace(/^[^︰:：]{1,12}[︰:：]/, '')
    .replace(/[（(][^）)]{1,16}[）)]/g, '')
    .trim()
  // 按句累积，短句太碎时并入下一句，直到达到可读长度（≥8 字）或 24 字上限。
  const parts = cleaned.split(/[。；;]/).map((item) => item.trim()).filter(Boolean)
  let acc = ''
  for (const part of parts) {
    acc = acc ? `${acc}，${part}` : part
    if ([...acc].length >= 8) break
  }
  const phrase = [...(acc || cleaned)].slice(0, 24).join('')
  return phrase.replace(/[，,、]$/, '').trim()
}

// 优先取描述性的分节（集解/形态、原典记述、主治、气味），最后才用释名（多为别名罗列）。
const noteFromSections = (sections: DetailSection[]) =>
  ['form', 'overview', 'uses', 'properties', 'names']
    .flatMap((kind) => sections.filter((section) => section.kind === kind))
    .map((section) => ancientNote(section.content))
    .filter((note) => note.length >= 6)[0] || ''

const rawUrlFor = (id: string) => {
  for (const ext of RAW_EXTS) {
    if (existsSync(resolve(OUTPUT_DIR, 'raw', `${id}.${ext}`))) return `/generated-herbs/raw/${id}.${ext}`
  }
  return undefined
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Wikisource 抓取会限流，失败重试并退避。
const fetchNote = async (id: string, attempts = 4): Promise<string> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${detailApi}/api/catalog/${id}`)
      if (response.ok) {
        const payload = await response.json() as { data?: { sections?: DetailSection[] } }
        return noteFromSections(payload.data?.sections || [])
      }
    } catch {
      // 网络异常，走重试
    }
    await sleep(600 * (attempt + 1))
  }
  return ''
}

const main = async () => {
  const manifestPath = 'data/media-manifest.json'
  const media = JSON.parse(await readFile(manifestPath, 'utf8')) as MediaEntry[]
  const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8')) as CatalogEntry[]
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]))

  const targets = media.filter(isGenerated)
  console.log(`共 ${media.length} 条，其中生成图 ${targets.length} 条`)

  // 第一遍：补 rawUrl（纯本地文件判断，立即落盘，保证架构可用）
  let rawSet = 0
  for (const item of targets) {
    const rawUrl = rawUrlFor(item.entryId)
    if (rawUrl && item.rawUrl !== rawUrl) { item.rawUrl = rawUrl; rawSet += 1 }
  }
  await saveJson(manifestPath, media)
  console.log(`已写入 rawUrl：${rawSet} 条`)

  // 第二遍：补 note（需要详情 API 抓原文，逐条落盘、可断点续跑）
  const pending = targets.filter((item) => overwriteNote || !item.note)
  console.log(`待补说明：${pending.length} 条（detail-api=${detailApi}，并发 ${concurrency}）`)
  let done = 0
  let cursor = 0
  let dirtySinceSave = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < pending.length) {
      const item = pending[cursor]
      cursor += 1
      const entry = catalogById.get(item.entryId)
      if (!entry) { done += 1; continue }
      const note = await fetchNote(item.entryId)
      if (note) item.note = note
      done += 1
      dirtySinceSave += 1
      await sleep(Number(readValue('--delay', '500')))
      if (dirtySinceSave >= 10) {
        dirtySinceSave = 0
        await saveJson(manifestPath, media)
        console.log(`  进度 ${done}/${pending.length}`)
      }
    }
  })
  await Promise.all(workers)
  await saveJson(manifestPath, media)
  const withNote = targets.filter((item) => item.note).length
  console.log(`完成。已有说明的条目：${withNote}/${targets.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
