/**
 * 用 DeepSeek 富化 data/catalog-details.json：为每条生成「简介」并把 7 项文言原文翻成白话译文。
 * 每条只调用一次 DeepSeek，返回一个 JSON：{ summary, translations:{ names, form, ... } }。
 * 可断点续跑：已富化（有 summary 且非空项都有译文）的条目自动跳过。
 *
 * 需要环境变量（可写在 .env / .env.local）：
 *   DEEPSEEK_API_KEY   必填
 *   DEEPSEEK_BASE_URL  选填，默认 https://api.deepseek.com
 *   DEEPSEEK_MODEL     选填，默认 deepseek-chat
 *
 * 用法：
 *   npx tsx scripts/enrich-details-deepseek.ts [--limit N] [--ids id1,id2] [--concurrency 4] [--overwrite]
 */
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'

type SectionKind = 'names' | 'form' | 'preparation' | 'properties' | 'uses' | 'commentary' | 'prescriptions'
type StoredSection = { kind: SectionKind; title: string; original: string; translation?: string }
type StoredDetail = { id: string; name: string; sourceUrl: string; retrievedAt: string; summary?: string; sections: StoredSection[] }

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
const limit = Number(readValue('--limit', '0'))
const idsFilter = readValue('--ids', '').split(',').map((s) => s.trim()).filter(Boolean)
const concurrency = Math.max(1, Number(readValue('--concurrency', '4')))
const overwrite = args.includes('--overwrite')

const OUT = 'data/catalog-details.json'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const loadEnv = async () => {
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
        if (m) process.env[m[1]] ||= m[2].trim().replace(/^['"]|['"]$/g, '')
      }
    } catch { /* optional */ }
  }
}

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

const needsEnrich = (detail: StoredDetail) => {
  if (overwrite) return true
  if (!detail.summary) return true
  return detail.sections.some((s) => s.original.trim() && !s.translation?.trim())
}

const buildPrompt = (detail: StoredDetail) => {
  const filled = detail.sections.filter((s) => s.original.trim())
  const body = filled.map((s) => `【${s.title}】(${s.kind})\n${s.original}`).join('\n\n')
  return [
    `你是中医药古籍整理专家。下面是《本草纲目》中「${detail.name}」的原文，按小节给出。`,
    '请完成两件事：',
    '1) summary：用现代白话写一段 40~70 字、通俗准确的简介，全面概括该物品是什么、性味、主要功用，供普通读者快速了解；不要出现"本文""该条目"之类字样。',
    '2) translations：把下列每个出现的小节的文言原文翻译成流畅的现代白话文，忠实原意、可读性强；保留其中的方剂、药量、出处（如《别录》）等信息。',
    '译文正文中不要重复小节名（不要出现「【释名】」「【集解】」之类前缀），直接给译文内容。',
    '仅返回严格 JSON，格式：',
    '{"summary":"...","translations":{"<kind>":"<该节译文>", ...}}',
    'translations 的 key 只使用下列出现过的小节英文标识，未出现的小节不要包含。',
    '',
    '原文如下：',
    body,
  ].join('\n')
}

const callDeepSeek = async (detail: StoredDetail, attempts = 4): Promise<{ summary?: string; translations?: Record<string, string> } | null> => {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY')
  const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是严谨的中医药古籍整理与翻译助手，只输出 JSON。' },
            { role: 'user', content: buildPrompt(detail) },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      })
      if (response.ok) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        const content = payload.choices?.[0]?.message?.content
        if (content) return JSON.parse(content)
      } else if ([400, 401, 402, 403].includes(response.status)) {
        // 参数/鉴权/余额类错误重试无意义，直接抛出（如 402 Insufficient Balance = 账户余额不足）
        throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 200)}`)
      }
    } catch (error) {
      if (attempt === attempts - 1) throw error
    }
    await sleep(800 * (attempt + 1))
  }
  return null
}

const main = async () => {
  await loadEnv()
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('请先设置 DEEPSEEK_API_KEY（可写入 .env.local）')
  if (!existsSync(OUT)) throw new Error(`未找到 ${OUT}，请先运行 sync-catalog-details.ts`)
  const store = JSON.parse(await readFile(OUT, 'utf8')) as Record<string, StoredDetail>

  let list = Object.values(store)
  if (idsFilter.length) list = list.filter((d) => idsFilter.includes(d.id) || idsFilter.includes(d.name))
  list = list.filter(needsEnrich)
  if (limit > 0) list = list.slice(0, limit)

  console.log(`待富化 ${list.length} 条（模型 ${process.env.DEEPSEEK_MODEL || 'deepseek-chat'}，并发 ${concurrency}）`)
  let cursor = 0
  let done = 0
  let ok = 0
  let dirty = 0
  let aborted = false
  const failures: Array<{ id: string; name: string; error: string }> = []
  const workers = Array.from({ length: Math.min(concurrency, list.length || 1) }, async () => {
    while (cursor < list.length && !aborted) {
      const detail = store[list[cursor].id]
      cursor += 1
      try {
        const result = await callDeepSeek(detail)
        if (result) {
          if (result.summary) detail.summary = String(result.summary).trim()
          const translations = result.translations || {}
          for (const section of detail.sections) {
            const t = translations[section.kind]
            if (section.original.trim() && t) section.translation = String(t).trim()
          }
          ok += 1
          dirty += 1
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ id: detail.id, name: detail.name, error: message })
        console.error(`  失败 ${detail.name}: ${message}`)
        if (/402|Insufficient Balance/i.test(message)) {
          aborted = true
          console.error('⚠ DeepSeek 账户余额不足，已中止。请充值后重跑本脚本即可续跑剩余条目。')
        }
      }
      done += 1
      if (dirty >= 10) { dirty = 0; await saveJson(OUT, store); console.log(`  进度 ${done}/${list.length}（成功累计 ${ok}）`) }
    }
  })
  await Promise.all(workers)
  await saveJson(OUT, store)
  console.log(`完成。本次成功 ${ok}/${list.length}，失败 ${failures.length}。`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
