import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname, resolve } from 'node:path'

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
  name: string
  status: 'matched' | 'review' | 'missing'
  confidence: 'high' | 'medium' | 'none'
  provider?: string
  imageUrl?: string
  thumbnailUrl?: string
  rawUrl?: string
  note?: string
  sourcePage?: string
  license?: string
  artist?: string
  description?: string
  generatedBy?: {
    model: string
    prompt: string
    generatedAt: string
    interactionId?: string
    layout?: string
  }
  retrievedAt: string
}

type Options = {
  mode: 'all' | 'unmatched' | 'missing' | 'pending'
  limit?: number
  offset: number
  category?: string
  id?: string
  concurrency: number
  delayMs: number
  dryRun: boolean
  overwrite: boolean
  detailApi?: string
  outputDir: string
  model: string
  aspectRatio: string
  imageSize: string
  progressJson: boolean
  style: 'labeled-note' | 'classic-page' | 'clean-specimen' | 'museum-card'
  idsFile?: string
}

type UsageMetadata = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
}

type DetailSection = {
  title: string
  kind: string
  content: string
}

type PromptPlan = {
  entry: CatalogEntry
  prompt: string
  note: string
}

type ProgressEvent = {
  type: string
  [key: string]: unknown
}

const IMAGE_OUTPUT_TOKENS_1K = 1120
const STANDARD_INPUT_USD_PER_MILLION = 0.25
const STANDARD_TEXT_OUTPUT_USD_PER_MILLION = 1.5
const STANDARD_IMAGE_OUTPUT_USD_PER_MILLION = 30
const BATCH_INPUT_USD_PER_MILLION = 0.125
const BATCH_TEXT_OUTPUT_USD_PER_MILLION = 0.75
const BATCH_IMAGE_OUTPUT_USD_PER_MILLION = 15

const categoryLabels: Record<string, string> = {
  water: '水部',
  fire: '火部',
  earth: '土部',
  'metal-stone': '金石部',
  herb: '草部',
  grain: '谷部',
  vegetable: '菜部',
  fruit: '果部',
  wood: '木部',
  utensil: '服器部',
  insect: '虫部',
  scale: '鳞部',
  shell: '介部',
  bird: '禽部',
  beast: '兽部',
  human: '人部',
}

const categoryNotes: Record<string, string> = {
  water: '水部清润，取天地之气',
  fire: '火部阳明，辨其性用',
  earth: '土部载物，辨其形质',
  'metal-stone': '金石坚凝，取其精华',
  herb: '草木有性，辨根叶花实',
  grain: '五谷为养，辨其气味',
  vegetable: '菜蔬入馔，亦归本草',
  fruit: '果实含生，辨其甘酸',
  wood: '木部有材，皮叶根实皆载',
  utensil: '器物入药，取其所宜',
  insect: '虫类微细，形性各殊',
  scale: '鳞介潜游，形质入药',
  shell: '介类坚藏，取其壳肉',
  bird: '禽类羽族，辨其形性',
  beast: '兽类有形，取其骨肉皮毛',
  human: '人部所载，存古籍旧说',
}

const sleep = (milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
const estimateTextTokens = (value: string) => Math.max(1, Math.ceil([...value].length / 2))
const imageOutputTokens = (imageSize: string) => imageSize.toLowerCase() === '1k' ? IMAGE_OUTPUT_TOKENS_1K : IMAGE_OUTPUT_TOKENS_1K
const estimateCost = (inputTokens: number, imageTokens: number, textOutputTokens = 0) => ({
  standardUsd: (inputTokens * STANDARD_INPUT_USD_PER_MILLION + textOutputTokens * STANDARD_TEXT_OUTPUT_USD_PER_MILLION + imageTokens * STANDARD_IMAGE_OUTPUT_USD_PER_MILLION) / 1_000_000,
  batchUsd: (inputTokens * BATCH_INPUT_USD_PER_MILLION + textOutputTokens * BATCH_TEXT_OUTPUT_USD_PER_MILLION + imageTokens * BATCH_IMAGE_OUTPUT_USD_PER_MILLION) / 1_000_000,
})

const emitProgress = (options: Options, event: ProgressEvent) => {
  if (!options.progressJson) return
  console.log(`__NANO_PROGRESS__${JSON.stringify({ at: new Date().toISOString(), ...event })}`)
}

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

const noteForEntry = (_entry: CatalogEntry, sections: DetailSection[] = []) => {
  // 优先描述性分节，别名（释名）作为最后兜底；取不到就留空，由前端不渲染说明。
  const candidates = ['form', 'overview', 'uses', 'properties', 'names']
    .flatMap((kind) => sections.filter((section) => section.kind === kind))
    .map((section) => ancientNote(section.content))
    .filter((note) => note.length >= 6)
  return candidates[0] || ''
}

const loadEnvFiles = async () => {
  for (const file of ['.env', '.env.local']) {
    try {
      const content = await readFile(file, 'utf8')
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
        if (!match) continue
        const [, key, rawValue] = match
        process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
      }
    } catch {
      // Optional local env file.
    }
  }
}

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

const isGeneratedMedia = (item?: MediaEntry) =>
  item?.provider === 'Google Gemini API / Nano Banana 2 Lite'
  || Boolean(item?.generatedBy)
  || Boolean(item?.thumbnailUrl?.startsWith('/generated-herbs/'))

const parseArgs = (): Options => {
  const args = process.argv.slice(2)
  const readValue = (name: string) => {
    const prefix = `${name}=`
    const exact = args.indexOf(name)
    if (exact >= 0) return args[exact + 1]
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  }
  const mode = (readValue('--mode') || 'unmatched') as Options['mode']
  if (!['all', 'unmatched', 'missing', 'pending'].includes(mode)) throw new Error('--mode must be all, unmatched, missing, or pending')
  return {
    mode,
    limit: readValue('--limit') ? Number(readValue('--limit')) : undefined,
    offset: Number(readValue('--offset') || 0),
    category: readValue('--category'),
    id: readValue('--id'),
    concurrency: Math.max(1, Number(readValue('--concurrency') || 1)),
    delayMs: Math.max(0, Number(readValue('--delay-ms') || 700)),
    dryRun: args.includes('--dry-run'),
    overwrite: args.includes('--overwrite'),
    detailApi: readValue('--detail-api')?.replace(/\/+$/, ''),
    outputDir: readValue('--output-dir') || 'public/generated-herbs',
    model: readValue('--model') || process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image',
    aspectRatio: readValue('--aspect-ratio') || '16:9',
    imageSize: readValue('--image-size') || '1K',
    progressJson: args.includes('--progress-json'),
    style: (readValue('--style') || 'labeled-note') as Options['style'],
    idsFile: readValue('--ids-file'),
  }
}

const selectedByMode = (entry: CatalogEntry, mediaById: Map<string, MediaEntry>, mode: Options['mode']) => {
  const match = mediaById.get(entry.id)
  if (mode === 'all') return true
  if (mode === 'pending') return !match
  if (mode === 'missing') return !match || match.status === 'missing'
  return !match || match.status !== 'matched'
}

const safeText = (value: string) => value.replace(/\s+/g, ' ').trim()

// 维基文库对突发请求会限流，失败时重试并退避，避免批量抓文时说明大面积丢失。
const getDetailSections = async (entry: CatalogEntry, detailApi?: string, attempts = 4): Promise<DetailSection[]> => {
  if (!detailApi) return []
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${detailApi}/api/catalog/${entry.id}`)
      if (response.ok) {
        const payload = await response.json() as { data?: { sections?: DetailSection[] } }
        return (payload.data?.sections || [])
          .filter((section) => ['names', 'form', 'overview', 'properties', 'uses'].includes(section.kind))
      }
    } catch {
      // 网络异常，进入重试
    }
    if (attempt < attempts - 1) await sleep(600 * (attempt + 1))
  }
  return []
}

const detailSummaryForSections = (sections: DetailSection[]) =>
  sections
    .slice(0, 4)
    .map((section) => `${section.title}: ${safeText(section.content).slice(0, 180)}`)
    .join('\n')

const stylePrompt = (style: Options['style'], entry: CatalogEntry) => {
  if (style === 'clean-specimen') {
    return [
      'Generate only the specimen illustration layer. No text, no title, no note, no seal, no border, no frame.',
      'Centered subject on plain warm rice paper. Full object visible.',
    ].join('\n')
  }
  if (style === 'classic-page') {
    return [
      'Generate only the specimen illustration layer for a classic Bencao plate.',
      'No text, no title, no note, no seal, no border, no frame, no paper-card shadow. Center the specimen on plain warm rice paper.',
    ].join('\n')
  }
  if (style === 'museum-card') {
    return [
      'Generate only the clean natural-history specimen illustration layer.',
      'No text, no title, no note, no seal, no label panel, no border, no watermark. Center the specimen on plain warm rice paper.',
    ].join('\n')
  }
  return [
    'Generate only the specimen illustration layer. Do not do any page layout.',
    'No text, no Chinese characters, no English, no title, no note, no seal, no border, no frame, no drop shadow, no watermark.',
    'Center the specimen on plain warm rice paper. Full object visible, with enough blank margin for later fixed layout.',
  ].join('\n')
}

const promptForEntry = (entry: CatalogEntry, options: Pick<Options, 'style'>, detailSummary: string) => {
  const exactName = entry.traditionalName && entry.traditionalName !== entry.name
    ? `${entry.name}（原文名：${entry.traditionalName}）`
    : entry.name
  const sensitiveGuidance = entry.category === 'human'
    ? 'If the subject is human-origin material, depict it only as a non-graphic historical materia medica museum specimen, sealed container, neutral texture, or symbolic study object. No gore, no wounds, no bodily fluids, no disturbing anatomy.'
    : entry.category === 'beast' || entry.category === 'bird' || entry.category === 'scale' || entry.category === 'insect' || entry.category === 'shell'
      ? 'If the subject is animal, insect, fish, shell, or a derived material, show a dignified natural-history specimen or living organism in a calm educational style. No cruelty, no dissection, no blood.'
      : 'Show the recognizable natural material, plant, mineral, food, tool, or medicinal part as a clean educational specimen.'

  return [
    'Create exactly one production-ready image for a digital visual atlas of Bencao Gangmu, the Ming dynasty Chinese materia medica compiled by Li Shizhen.',
    `Subject: ${exactName}.`,
    `Catalog context: ${categoryLabels[entry.category] || entry.category} · ${entry.chapter} · original order ${entry.chapterOrder}.`,
    detailSummary ? `Reference notes from the current project data:\n${detailSummary}` : '',
    sensitiveGuidance,
    'Base style contract for every image in this project: Ming-dynasty Chinese materia medica specimen illustration, precise natural-history rendering, clean scholarly visual language, muted mineral pigments, fine ink-outline details, warm xuan/rice paper texture, subtle aging marks, soft controlled shadow, no fantasy, no decorative clutter.',
    'Accuracy requirements: prioritize the identifiable medicinal material and its diagnostic morphology. For plants, show the plant part used in materia medica and, when useful, one restrained botanical cue such as leaf, flower, fruit, root, rhizome, bark, seed, or mineral texture. For minerals and non-plant entries, show a clear museum-specimen view.',
    'Composition: wide landscape 16:9 raw specimen image, centered single subject, high clarity, full object visible, no cropping of the specimen. Leave generous blank paper margin for later square-card layout. Do not add any layout elements.',
    stylePrompt(options.style, entry),
  ].filter(Boolean).join('\n')
}

const planForEntry = async (entry: CatalogEntry, options: Pick<Options, 'detailApi' | 'style'>): Promise<PromptPlan> => {
  const detailSections = await getDetailSections(entry, options.detailApi)
  const detailSummary = detailSummaryForSections(detailSections)
  return {
    entry,
    prompt: promptForEntry(entry, options, detailSummary),
    note: noteForEntry(entry, detailSections),
  }
}

const extensionFromMime = (mimeType?: string) => {
  if (mimeType?.includes('jpeg')) return '.jpg'
  if (mimeType?.includes('webp')) return '.webp'
  if (mimeType?.includes('png')) return '.png'
  return '.png'
}

const composePlate = (rawPath: string, outputPath: string, entry: CatalogEntry, note: string) => {
  const result = spawnSync('python', [
    'scripts/compose-bencao-plate.py',
    '--raw', rawPath,
    '--output', outputPath,
    '--title', entry.name,
    '--note', note,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`Compose failed: ${result.stderr || result.stdout}`)
  }
}

const findImage = (value: unknown): { data: string; mimeType?: string } | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const outputImage = record.output_image || record.outputImage
  if (outputImage && typeof outputImage === 'object') {
    const block = outputImage as Record<string, unknown>
    if (typeof block.data === 'string') return { data: block.data, mimeType: String(block.mime_type || block.mimeType || 'image/png') }
  }
  if (typeof record.data === 'string') {
    const mimeType = String(record.mime_type || record.mimeType || record.mime || '')
    if (mimeType.startsWith('image/')) return { data: record.data, mimeType }
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findImage(item)
        if (found) return found
      }
    } else {
      const found = findImage(child)
      if (found) return found
    }
  }
  return null
}

const findUsage = (value: unknown): UsageMetadata | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const direct = record.usageMetadata || record.usage_metadata || record.usage
  if (direct && typeof direct === 'object') return direct as UsageMetadata
  if ('promptTokenCount' in record || 'prompt_token_count' in record || 'totalTokenCount' in record || 'total_token_count' in record) {
    return {
      promptTokenCount: Number(record.promptTokenCount || record.prompt_token_count || 0) || undefined,
      candidatesTokenCount: Number(record.candidatesTokenCount || record.candidates_token_count || 0) || undefined,
      totalTokenCount: Number(record.totalTokenCount || record.total_token_count || 0) || undefined,
      thoughtsTokenCount: Number(record.thoughtsTokenCount || record.thoughts_token_count || 0) || undefined,
    }
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findUsage(item)
        if (found) return found
      }
    } else {
      const found = findUsage(child)
      if (found) return found
    }
  }
  return undefined
}

const generateImage = async (prompt: string, options: Options) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY')
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: options.model,
      input: [{ type: 'text', text: prompt }],
      response_format: {
        type: 'image',
        aspect_ratio: options.aspectRatio,
        image_size: options.imageSize,
      },
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(payload)}`)
  const image = findImage(payload)
  if (!image) throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1200)}`)
  return {
    ...image,
    interactionId: typeof payload?.id === 'string' ? payload.id : undefined,
    usage: findUsage(payload),
  }
}

const writeMediaReport = async (catalog: CatalogEntry[], media: MediaEntry[]) => {
  const report = {
    catalogTotal: catalog.length,
    processed: media.length,
    matched: media.filter((item) => item.status === 'matched').length,
    review: media.filter((item) => item.status === 'review').length,
    missing: media.filter((item) => item.status === 'missing').length,
    pending: catalog.length - media.length,
    generatedAt: new Date().toISOString(),
  }
  await writeFile('data/media-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

const main = async () => {
  await loadEnvFiles()
  const options = parseArgs()
  const catalog = await readJson<CatalogEntry[]>('data/catalog.json', [])
  const media = await readJson<MediaEntry[]>('data/media-manifest.json', [])
  const mediaById = new Map(media.map((item) => [item.entryId, item]))
  const ids = options.idsFile ? await readJson<string[]>(options.idsFile, []) : undefined
  const idOrder = ids ? new Map(ids.map((id, index) => [id, index])) : undefined
  const startedAt = new Date().toISOString().replace(/[:.]/g, '-')

  let entries = catalog
    .filter((entry) => ids ? idOrder?.has(entry.id) : selectedByMode(entry, mediaById, options.mode))
    .filter((entry) => !options.category || entry.category === options.category)
    .filter((entry) => !options.id || entry.id === options.id || entry.name === options.id || entry.traditionalName === options.id)
    .filter((entry) => options.overwrite || !isGeneratedMedia(mediaById.get(entry.id)))
    .sort((a, b) => (idOrder?.get(a.id) ?? 0) - (idOrder?.get(b.id) ?? 0))
    .slice(options.offset)
  if (options.limit) entries = entries.slice(0, options.limit)
  // 抓原文（用于提示词与说明）改为小并发，避免一次性并发把维基文库抓文全部砸出去被限流。
  const PLAN_CONCURRENCY = 3
  const plannedPrompts: PromptPlan[] = new Array(entries.length)
  let planCursor = 0
  await Promise.all(Array.from({ length: Math.min(PLAN_CONCURRENCY, entries.length || 1) }, async () => {
    while (planCursor < entries.length) {
      const index = planCursor
      planCursor += 1
      plannedPrompts[index] = await planForEntry(entries[index], options)
      await sleep(150)
    }
  }))
  const estimatedInputTokens = plannedPrompts.reduce((sum, item) => sum + estimateTextTokens(item.prompt), 0)
  const estimatedImageTokens = plannedPrompts.length * imageOutputTokens(options.imageSize)
  const estimatedCost = estimateCost(estimatedInputTokens, estimatedImageTokens)

  console.log(`Nano Banana 2 Lite batch: ${entries.length}/${catalog.length} entries selected`)
  console.log(`mode=${options.mode} model=${options.model} output=${options.outputDir} dryRun=${options.dryRun}`)
  emitProgress(options, {
    type: 'start',
    total: entries.length,
    catalogTotal: catalog.length,
    model: options.model,
    style: options.style,
    imageSize: options.imageSize,
    aspectRatio: options.aspectRatio,
    estimatedInputTokens,
    estimatedImageTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedImageTokens,
    estimatedStandardUsd: estimatedCost.standardUsd,
    estimatedBatchUsd: estimatedCost.batchUsd,
    pricing: {
      imageOutputTokensPer1K: IMAGE_OUTPUT_TOKENS_1K,
      standardInputUsdPerMillion: STANDARD_INPUT_USD_PER_MILLION,
      standardImageOutputUsdPerMillion: STANDARD_IMAGE_OUTPUT_USD_PER_MILLION,
      batchInputUsdPerMillion: BATCH_INPUT_USD_PER_MILLION,
      batchImageOutputUsdPerMillion: BATCH_IMAGE_OUTPUT_USD_PER_MILLION,
    },
  })

  if (options.dryRun) {
    for (const { entry, prompt } of plannedPrompts.slice(0, 10)) {
      console.log('\n---')
      console.log(`${entry.id} ${entry.name} ${categoryLabels[entry.category] || entry.category} ${entry.chapter}`)
      console.log(prompt)
    }
    return
  }

  if (!process.env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY before running without --dry-run')
  await mkdir(options.outputDir, { recursive: true })
  await mkdir(resolve(options.outputDir, 'raw'), { recursive: true })
  await mkdir('data/generation-failures', { recursive: true })
  if (existsSync('data/media-manifest.json')) {
    await copyFile('data/media-manifest.json', `data/media-manifest.backup-${startedAt}.json`)
  }

  const failures: Array<{ id: string; name: string; error: string }> = []
  const usageTotals = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
    estimatedInputTokens: 0,
    estimatedImageTokens: 0,
  }
  const planById = new Map(plannedPrompts.map((item) => [item.entry.id, item]))
  let cursor = 0
  const workers = Array.from({ length: options.concurrency }, async (_, workerIndex) => {
    while (cursor < entries.length) {
      const entry = entries[cursor]
      cursor += 1
      const toUrl = (relative: string) => `/${options.outputDir.replace(/^public[\\/]/, '').replace(/\\/g, '/')}/${relative}`
      const rawHit = ['jpg', 'png', 'webp'].map((ext) => ({ ext, path: resolve(options.outputDir, 'raw', `${entry.id}.${ext}`) })).find((candidate) => existsSync(candidate.path))
      const composedHit = ['png', 'jpg', 'webp'].map((ext) => ({ ext, path: resolve(options.outputDir, `${entry.id}.${ext}`) })).find((candidate) => existsSync(candidate.path))
      if (!options.overwrite && (rawHit || composedHit)) {
        const rawUrl = rawHit ? toUrl(`raw/${entry.id}.${rawHit.ext}`) : undefined
        const servedUrl = rawUrl || toUrl(`${entry.id}.${composedHit!.ext}`)
        const now = new Date().toISOString()
        const previous = mediaById.get(entry.id)
        const plan = planById.get(entry.id) || await planForEntry(entry, options)
        mediaById.set(entry.id, {
          ...(previous || {}),
          entryId: entry.id,
          name: entry.name,
          status: 'matched',
          confidence: 'high',
          provider: 'Google Gemini API / Nano Banana 2 Lite',
          imageUrl: servedUrl,
          thumbnailUrl: servedUrl,
          rawUrl,
          note: previous?.note || plan.note,
          sourcePage: entry.sourceUrl,
          license: 'AI-generated; SynthID watermark',
          description: `${entry.name} generated visual atlas image`,
          retrievedAt: now,
        })
        console.log(`[${workerIndex}] reuse ${entry.name} -> ${servedUrl}`)
        emitProgress(options, { type: 'entry-reuse', workerIndex, id: entry.id, name: entry.name, imageUrl: servedUrl })
        continue
      }

      try {
        const plan = planById.get(entry.id) || await planForEntry(entry, options)
        const { prompt, note } = plan
        emitProgress(options, { type: 'entry-start', workerIndex, id: entry.id, name: entry.name, estimatedInputTokens: estimateTextTokens(prompt), estimatedImageTokens: imageOutputTokens(options.imageSize) })
        const image = await generateImage(prompt, options)
        const extension = extensionFromMime(image.mimeType)
        const rawPath = resolve(options.outputDir, 'raw', `${entry.id}${extension}`)
        await writeFile(rawPath, Buffer.from(image.data, 'base64'))
        // 不再合成 1:1 题签图：直接提供无字原图，标题与说明由前端叠加，便于随时调整字体与字号。
        const publicUrl = `/${options.outputDir.replace(/^public[\\/]/, '').replace(/\\/g, '/')}/raw/${entry.id}${extension}`
        const now = new Date().toISOString()
        mediaById.set(entry.id, {
          entryId: entry.id,
          name: entry.name,
          status: 'matched',
          confidence: 'high',
          provider: 'Google Gemini API / Nano Banana 2 Lite',
          imageUrl: publicUrl,
          thumbnailUrl: publicUrl,
          rawUrl: publicUrl,
          note,
          sourcePage: entry.sourceUrl,
          license: 'AI-generated; SynthID watermark',
          description: `${entry.name} generated visual atlas image`,
          generatedBy: {
            model: options.model,
            prompt,
            generatedAt: now,
            interactionId: image.interactionId,
            layout: 'frontend-overlay-title-note-v2',
          },
          retrievedAt: now,
        })
        const estimatedInput = estimateTextTokens(prompt)
        const estimatedImage = imageOutputTokens(options.imageSize)
        usageTotals.estimatedInputTokens += estimatedInput
        usageTotals.estimatedImageTokens += estimatedImage
        usageTotals.promptTokenCount += image.usage?.promptTokenCount || 0
        usageTotals.candidatesTokenCount += image.usage?.candidatesTokenCount || 0
        usageTotals.totalTokenCount += image.usage?.totalTokenCount || 0
        await writeFile('data/media-manifest.json', `${JSON.stringify([...mediaById.values()], null, 2)}\n`, 'utf8')
        await writeMediaReport(catalog, [...mediaById.values()])
        console.log(`[${workerIndex}] generated ${entry.name} -> ${publicUrl}`)
        const cost = estimateCost(usageTotals.promptTokenCount || usageTotals.estimatedInputTokens, usageTotals.estimatedImageTokens, usageTotals.candidatesTokenCount)
        emitProgress(options, {
          type: 'entry-success',
          workerIndex,
          id: entry.id,
          name: entry.name,
          imageUrl: publicUrl,
          usage: image.usage,
          estimatedInputTokens: estimatedInput,
          estimatedImageTokens: estimatedImage,
          totals: {
            ...usageTotals,
            estimatedTotalTokens: usageTotals.estimatedInputTokens + usageTotals.estimatedImageTokens,
            standardUsd: cost.standardUsd,
            batchUsd: cost.batchUsd,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ id: entry.id, name: entry.name, error: message })
        await writeFile(`data/generation-failures/nano-banana-${startedAt}.json`, `${JSON.stringify(failures, null, 2)}\n`, 'utf8')
        console.error(`[${workerIndex}] failed ${entry.name}: ${message}`)
        emitProgress(options, { type: 'entry-failure', workerIndex, id: entry.id, name: entry.name, error: message })
      }
      if (options.delayMs) await sleep(options.delayMs)
    }
  })

  await Promise.all(workers)
  await writeFile('data/media-manifest.json', `${JSON.stringify([...mediaById.values()], null, 2)}\n`, 'utf8')
  await writeMediaReport(catalog, [...mediaById.values()])
  console.log(`Done. success=${entries.length - failures.length} failed=${failures.length}`)
  const finalCost = estimateCost(usageTotals.promptTokenCount || usageTotals.estimatedInputTokens, usageTotals.estimatedImageTokens, usageTotals.candidatesTokenCount)
  emitProgress(options, {
    type: 'done',
    success: entries.length - failures.length,
    failed: failures.length,
    totals: {
      ...usageTotals,
      estimatedTotalTokens: usageTotals.estimatedInputTokens + usageTotals.estimatedImageTokens,
      standardUsd: finalCost.standardUsd,
      batchUsd: finalCost.batchUsd,
    },
  })
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
