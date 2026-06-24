# 本草万象

《本草纲目》数字分类与药材可视化原型。前端采用 React + TypeScript + Vite，后端采用 Express；当前包含十六部分类、1,712 个正文主条目、图片图鉴、搜索/分类筛选、双排序、原典详情和响应式布局。

项目还包含一套可重复执行的全目录与开放图片整理管线。维基文库正文目前抽取出 1,712 个二级主条目；常见的“1,892 种药物”数字还包含一部分附属药物、部位和异名，两者不能直接混用。

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
```

生成文件：

- `data/catalog.json`：1,712 个正文主条目及原典链接
- `data/catalog-summary.json`：各部主条目数量
- `data/media-manifest.json`：图片、作者、许可、来源及置信度
- `data/media-report.json`：当前覆盖率
- `data/original-plate-sources.json`：公版原典插图回退源

图片状态分为：

- `matched`：百科标题 → Wikidata → Commons 文件的高置信度链路
- `review`：Commons 搜索候选，需要人工确认物种或药材形态
- `missing`：开放图库暂未找到
- `pending`：尚未处理

> 页面内容用于数字人文和信息设计展示，不构成医疗建议。Wikimedia Commons 占位图的具体许可与来源可在药材详情中查看。
