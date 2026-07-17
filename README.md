# 本草万象

《本草纲目》数字分类与药材可视化原型。前端采用 React + TypeScript + Vite，后端采用 Express；当前包含十六部分类、1,712 个正文主条目、图片图鉴、搜索/分类筛选、双排序、原典详情和响应式布局。

项目还包含一套可重复执行的全目录与开放图片整理管线。维基文库正文目前抽取出 1,712 个二级主条目；常见的“1,892 种药物”数字还包含一部分附属药物、部位和异名，两者不能直接混用。

## 在线演示（GitHub Pages）

静态演示站点：<https://liyucheng1997.github.io/106_book-bencao-gangmu/>

站点内容存放在本仓库的 `gh-pages` 分支：目录数据与原典正文已静态化为 JSON，由 `demo-api.js` 在浏览器内复刻服务器逻辑，线上无需后端。图片批量生成为本地工具链功能，线上只读展示。更新站点时，重新生成静态资源后推送到 `gh-pages` 分支即可（注意资源内的绝对路径需带 `/106_book-bencao-gangmu/` 子路径前缀）。

## 本地开发

```bash
npm install
npm run dev
```

- 前端：Vite 会输出实际端口，默认 `http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`

## 构建与运行

```bash
npm run build
npm start
```

构建后 Express 会同时提供 API 与 `dist/` 前端页面，访问 `http://127.0.0.1:8787`。

## API

- `GET /api/health`：健康检查
- `GET /api/stats`：典籍统计
- `GET /api/categories`：十六部分类
- `GET /api/herbs`：药材列表
- `GET /api/herbs?q=人参&category=herb`：搜索与筛选
- `GET /api/herbs/:id`：药材详情
- `GET /api/catalog?page=1&limit=24`：完整主条目目录与图片匹配状态
- `GET /api/catalog?sort=original|name`：按原著次序或名称排序
- `GET /api/catalog/:id`：按释名、集解、修治、气味、主治、发明、附方等层次读取原典详情
- `GET /api/catalog/stats`：目录和图片覆盖率

药材种子数据位于 `server/data.ts`，占位图位于 `public/herbs/`。新增生成图时，建议保持药材 `id` 与图片文件名一致，并在数据中保留来源、版本与生成提示词字段，便于后续追踪资产。

## 全目录与图片整理

```bash
# 从维基文库原文结构同步主条目目录
npm run catalog:sync

# 批量通过中文维基百科、Wikidata 的 P18 属性匹配高置信度图片
npm run media:batch

# 用中文标签与别名补充图片候选（统一进入待复核队列）
npm run media:aliases

# 对未匹配条目逐个检索 Wikimedia Commons，输出待复核候选
npm run media:match -- --limit=50

# 使用 Nano Banana 2 Lite 为目录条目生成本地统一风格图片
npm run media:nano -- --dry-run --mode all --limit=3
```

真正调用 Gemini API 前，在项目根目录创建 `.env.local`：

```env
GEMINI_API_KEY=你的 Google AI Studio API Key
```

然后运行：

```bash
npm run media:nano -- --mode all --concurrency=1 --delay-ms=700 --overwrite
```

也可以在网页中直接启动生成：先构建并启动服务，然后访问页面中的“图像生成控制台”。

```bash
npm run build
$env:PORT="8790"
npm start
```

访问 `http://127.0.0.1:8790`。控制台会显示当前生成条目、进度、最新生成图、估算 token，以及按 Gemini 官方定价口径折算的标准价格和 Batch 价格估算。生成成功后图片写入 `public/generated-herbs/`，并即时更新 `data/media-manifest.json`，当前图鉴页会自动刷新替换占位图。

网页中有两种生成入口：

- 每张图右下角的 `生成` / `重新生成`：只处理该单个条目；已有 Nano Banana 图时会覆盖重做。
- 控制台里的 `批量生成当前页`：处理当前页面 24 个条目，默认跳过已经由 Nano Banana 生成过的图。

风格可在控制台切换：

- `题签说明版`：1:1 方图，标题 + 简短说明 + 右侧印章，适合先试统一图鉴风格。
- `古籍页版`：1:1 方图，更接近古籍页边题注，右侧印章。
- `博物卡片版`：偏现代博物馆标本卡。
- `无字标本版`：无标题、无文字，只保留标本主体。

生成文件：

- `data/catalog.json`：1,712 个正文主条目及原典链接
- `data/catalog-summary.json`：各部主条目数量
- `data/media-manifest.json`：图片、作者、许可、来源及置信度
- `data/media-report.json`：当前覆盖率
- `data/original-plate-sources.json`：公版原典插图回退源
- `public/generated-herbs/`：Nano Banana 2 Lite 生成的本地图鉴图片

图片状态分为：

- `matched`：百科标题 → Wikidata → Commons 文件的高置信度链路
- `review`：Commons 搜索候选，需要人工确认物种或药材形态
- `missing`：开放图库暂未找到
- `pending`：尚未处理

`media:nano` 使用 Google Gemini Interactions API 的 Nano Banana 2 Lite 模型 ID `gemini-3.1-flash-lite-image`。脚本会把生成图写入 `public/generated-herbs/{entryId}.png`，并把 `data/media-manifest.json` 中对应条目的 `thumbnailUrl/imageUrl` 改为本地路径，因此无需修改 React 页面即可替换图鉴和详情页图片。

费用估算以 1K 图片输出 1,120 image tokens 计算。脚本会记录提示词估算 token；如果 API 返回 `usageMetadata`，页面会优先展示实际 token，否则展示估算值。

常用参数：

- `--mode all`：为 1,712 个主条目全部生成并替换。
- `--mode unmatched`：只处理未匹配或待复核/缺图条目，默认值。
- `--mode missing`：只处理缺图和未处理条目。
- `--category herb` / `--id 人参`：局部生成。
- `--limit 20 --offset 40`：分批执行。
- `--detail-api http://127.0.0.1:8787`：调用本地详情 API，把原典片段加入提示词。
- `--style labeled-note|classic-page|museum-card|clean-specimen`：切换图像风格版本。
- `--aspect-ratio 1:1`：默认方图，适配当前图鉴卡片。
- `--dry-run`：只打印提示词，不调用模型。
- `--overwrite`：已有本地生成图时重新生成，否则复用已有文件并更新 manifest。

> 页面内容用于数字人文和信息设计展示，不构成医疗建议。Wikimedia Commons 占位图的具体许可与来源可在药材详情中查看。
