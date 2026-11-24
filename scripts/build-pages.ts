/**
 * 构建 GitHub Pages 静态演示站，可选直接发布到 gh-pages 分支。
 *
 *   npm run pages:build    # 输出到 dist-pages/
 *   npm run pages:deploy   # 构建后同步到 gh-pages 分支并推送
 *
 * 线上没有后端：pages/demo-api.js 拦截 /api 请求，从静态 JSON 里复刻服务器逻辑。
 * 原典正文按条目拆成 data/details/{id}.json，打开详情才加载；
 * 列表只需目录、图片清单和简介（data/summaries.json），首屏不再下载 3.5MB 全量正文。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { categories, herbs } from '../server/data.js'

const OUT = resolve('dist-pages')
const deploy = process.argv.includes('--deploy')

const run = (command: string, args: string[], cwd = process.cwd()) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.stderr || result.stdout}`)
  return result.stdout.trim()
}
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), 'utf8')

type Detail = { summary?: string; sections: unknown[]; sourceUrl: string; retrievedAt: string }
type Media = { status: string }

// 1. 前端：相对 base，部署到任何子路径都能用
run(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--base', './', '--outDir', OUT, '--emptyOutDir'])
// public/generated-herbs 根目录下是旧版合成图（已不引用），不发布
for (const file of readdirSync(join(OUT, 'generated-herbs'), { withFileTypes: true })) {
  if (file.isFile()) rmSync(join(OUT, 'generated-herbs', file.name))
}

// 2. 数据：目录 + 图片清单 + 简介；正文逐条拆分
const catalog = readJson<Array<{ id: string }>>('data/catalog.json')
const media = readJson<Media[]>('data/media-manifest.json')
const details = readJson<Record<string, Detail>>('data/catalog-details.json')
mkdirSync(join(OUT, 'data', 'details'), { recursive: true })
writeJson(join(OUT, 'data', 'catalog.json'), catalog)
// 线上只保留界面用得到的字段（生成提示词等溯源信息留在仓库的完整 manifest 里）
const MEDIA_FIELDS = ['entryId', 'status', 'confidence', 'provider', 'thumbnailUrl', 'imageUrl', 'rawUrl', 'note', 'sourcePage', 'license', 'artist', 'matchedTitle', 'identifiedAs']
writeJson(join(OUT, 'data', 'media-manifest.json'), media.map((item) =>
  Object.fromEntries(MEDIA_FIELDS.filter((key) => (item as Record<string, unknown>)[key] !== undefined).map((key) => [key, (item as Record<string, unknown>)[key]]))))
const summaries: Record<string, string> = {}
for (const [id, detail] of Object.entries(details)) {
  if (detail.summary) summaries[id] = detail.summary
  writeJson(join(OUT, 'data', 'details', `${encodeURIComponent(id)}.json`), {
    summary: detail.summary, sections: detail.sections, sourceUrl: detail.sourceUrl, retrievedAt: detail.retrievedAt,
  })
}
writeJson(join(OUT, 'data', 'summaries.json'), summaries)

// 3. 与 server/index.ts 对应接口一致的固定响应
writeJson(join(OUT, 'fx-categories.json'), { data: categories })
writeJson(join(OUT, 'fx-stats.json'), {
  data: { volumes: 52, categories: 16, subcategories: 60, entries: 1892, prescriptions: 11096, illustrations: 1160, demoEntries: herbs.length },
})
writeJson(join(OUT, 'fx-catalog-stats.json'), {
  data: {
    total: catalog.length,
    matched: media.filter((item) => item.status === 'matched').length,
    review: media.filter((item) => item.status === 'review').length,
    missing: media.filter((item) => item.status === 'missing').length,
    pending: Math.max(0, catalog.length - media.length),
  },
})
writeJson(join(OUT, 'fx-generation-status.json'), {
  data: {
    id: 'idle', status: 'idle', total: 0, completed: 0, succeeded: 0, failed: 0, reused: 0,
    model: 'gemini-3.1-flash-lite-image', mode: 'pending', overwrite: false,
    estimatedInputTokens: 0, estimatedImageTokens: 0, estimatedTotalTokens: 0, estimatedStandardUsd: 0, estimatedBatchUsd: 0, logs: [],
  },
})

// 4. 演示后端脚本：带内容哈希做缓存版本号，插在前端模块之前
const demoApi = readFileSync('pages/demo-api.js', 'utf8')
writeFileSync(join(OUT, 'demo-api.js'), demoApi, 'utf8')
const version = createHash('sha1').update(demoApi).digest('hex').slice(0, 8)
const indexPath = join(OUT, 'index.html')
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace(
  '<script type="module"',
  `<script src="./demo-api.js?v=${version}"></script>\n    <script type="module"`,
), 'utf8')
writeFileSync(join(OUT, '.nojekyll'), '')

const detailFiles = readdirSync(join(OUT, 'data', 'details')).length
console.log(`pages: 已输出 ${OUT}（正文 ${detailFiles} 个条目文件，简介 ${Object.keys(summaries).length} 条）`)

// 5. 发布：在临时 worktree 里整体替换 gh-pages 内容
if (deploy) {
  const sha = run('git', ['rev-parse', '--short', 'HEAD'])
  const pkg = readJson<{ version: string }>('package.json')
  run('git', ['fetch', 'origin', 'gh-pages'])
  const worktree = mkdtempSync(join(tmpdir(), 'bencao-pages-'))
  run('git', ['worktree', 'add', '--detach', worktree, 'origin/gh-pages'])
  try {
    for (const name of readdirSync(worktree)) if (name !== '.git') rmSync(join(worktree, name), { recursive: true, force: true })
    cpSync(OUT, worktree, { recursive: true })
    run('git', ['add', '-A'], worktree)
    if (!run('git', ['status', '--porcelain'], worktree)) {
      console.log('pages: gh-pages 无变化，跳过提交')
    } else {
      run('git', ['commit', '-m', `发布 ${pkg.version}（main ${sha}）`], worktree)
      run('git', ['push', 'origin', 'HEAD:gh-pages'], worktree)
      console.log(`pages: 已推送到 gh-pages（main ${sha}）`)
    }
  } finally {
    run('git', ['worktree', 'remove', '--force', worktree])
    if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true })
  }
}
