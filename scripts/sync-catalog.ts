import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

type WikiSection = {
  toclevel: number
  level: string
  line: string
  anchor: string
  number: string
}

type CatalogEntry = {
  id: string
  name: string
  traditionalName: string
  category: string
  chapter: string
  chapterOrder: number
  sourceUrl: string
  sourceAnchor: string
  mediaStatus: 'pending'
}

const API = 'https://zh.wikisource.org/w/api.php'
const ROOT_PAGE = '本草綱目'
const CATEGORY_ORDER = ['water', 'fire', 'earth', 'metal-stone', 'herb', 'grain', 'vegetable', 'fruit', 'wood', 'utensil', 'insect', 'scale', 'shell', 'bird', 'beast', 'human']
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const categoryFor = (chapter: string) => {
  if (chapter === '水部') return 'water'
  if (chapter === '火部') return 'fire'
  if (chapter === '土部') return 'earth'
  if (chapter.startsWith('金石')) return 'metal-stone'
  if (chapter.startsWith('草之') || chapter === '雜草') return 'herb'
  if (chapter.startsWith('穀之')) return 'grain'
  if (chapter.startsWith('菜之')) return 'vegetable'
  if (chapter.startsWith('果之')) return 'fruit'
  if (chapter.startsWith('木之')) return 'wood'
  if (chapter === '服器部') return 'utensil'
  if (chapter.startsWith('蟲之')) return 'insect'
  if (chapter.startsWith('鱗之')) return 'scale'
  if (chapter.startsWith('介之')) return 'shell'
  if (chapter.startsWith('禽之')) return 'bird'
  if (chapter.startsWith('獸之')) return 'beast'
  if (chapter === '人部') return 'human'
  return null
}

const request = async (params: Record<string, string>, attempt = 0): Promise<any> => {
  const url = new URL(API)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BencaoVisualAtlas/0.2 (catalog research; local educational project)',
      'Api-User-Agent': 'BencaoVisualAtlas/0.2 (catalog research; local educational project)',
    },
  })
  if (response.status === 429 && attempt < 6) {
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    await sleep(Math.max(retryAfter * 1000, 2500 * 2 ** attempt))
    return request(params, attempt + 1)
  }
  if (!response.ok) throw new Error(`Wikisource ${response.status}: ${url}`)
  return response.json()
}

const getRootLinks = async () => {
  const result = await request({
    action: 'parse', page: ROOT_PAGE, prop: 'links', format: 'json', formatversion: '2',
  })
  return (result.parse.links as Array<{ ns: number; title: string }>)
    .filter((link) => link.ns === 0 && link.title.startsWith(`${ROOT_PAGE}/`))
    .map((link) => link.title)
    .filter((title) => categoryFor(title.split('/')[1]) !== null)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

const getSections = async (page: string) => {
  const result = await request({
    action: 'parse', page, prop: 'sections', format: 'json', formatversion: '2', variant: 'zh-hans',
  })
  return result.parse.sections as WikiSection[]
}

const findEntrySections = (sections: WikiSection[]) => {
  if (!sections.length) return []
  const levels = [...new Set(sections.map((section) => Number(section.level)))].sort((a, b) => a - b)
  const minimum = levels[0]
  const topLevel = sections.filter((section) => Number(section.level) === minimum)
  if (topLevel.length >= 5) return topLevel

  const nextLevel = sections.filter((section) => Number(section.level) === minimum + 1)
  return nextLevel.length > topLevel.length ? nextLevel : topLevel
}

const makeId = (page: string, anchor: string) =>
  `bgm-${createHash('sha1').update(`${page}#${anchor}`).digest('hex').slice(0, 12)}`

const main = async () => {
  const pages = await getRootLinks()
  const entries: CatalogEntry[] = []

  for (const page of pages) {
    const sections = await getSections(page)
    const chapter = page.split('/')[1]
    const category = categoryFor(chapter)
    if (!category) continue

    const mainSections = findEntrySections(sections)

    mainSections.forEach((section, index) => {
      entries.push({
        id: makeId(page, section.anchor),
        name: section.line,
        traditionalName: section.line,
        category,
        chapter,
        chapterOrder: index + 1,
        sourceUrl: `https://zh.wikisource.org/wiki/${encodeURIComponent(page)}`,
        sourceAnchor: section.anchor,
        mediaStatus: 'pending',
      })
    })
    console.log(`${chapter}: ${mainSections.length}`)
    await sleep(450)
  }

  await mkdir('data', { recursive: true })
  entries.sort((a, b) => {
    const categoryDifference = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    if (categoryDifference) return categoryDifference
    const chapterDifference = a.chapter.localeCompare(b.chapter, 'zh-Hant-u-co-stroke')
    return chapterDifference || a.chapterOrder - b.chapterOrder
  })
  await writeFile('data/catalog.json', `${JSON.stringify(entries, null, 2)}\n`, 'utf8')

  const counts = Object.fromEntries(
    [...new Set(entries.map((entry) => entry.category))].map((category) => [
      category,
      entries.filter((entry) => entry.category === category).length,
    ]),
  )
  await writeFile('data/catalog-summary.json', `${JSON.stringify({ total: entries.length, chapters: pages.length, counts }, null, 2)}\n`, 'utf8')
  console.log(`目录完成：${entries.length} 条，${pages.length} 个章节。`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
