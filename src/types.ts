export type Category = {
  id: string
  name: string
  mark: string
  count: number
  tone: string
  note: string
}

export type Herb = {
  id: string
  name: string
  pinyin: string
  latin: string
  category: string
  subcategory: string
  part: string
  nature: string
  flavor: string
  origin: string
  summary: string
  classic: string
  tags: string[]
  image: string
  imageSource: string
  imageLicense: string
}

export type Stats = {
  volumes: number
  categories: number
  subcategories: number
  entries: number
  prescriptions: number
  illustrations: number
  demoEntries: number
}

export type CatalogMedia = {
  status: 'matched' | 'review' | 'missing' | 'pending'
  confidence: 'high' | 'medium' | 'none'
  thumbnailUrl?: string
  imageUrl?: string
  rawUrl?: string
  note?: string
  sourcePage?: string
  license?: string
  artist?: string
  matchedTitle?: string
  provider?: string
  generatedBy?: unknown
}

export type CatalogEntry = {
  id: string
  name: string
  traditionalName: string
  category: string
  chapter: string
  chapterOrder: number
  sourceUrl: string
  sourceAnchor: string
  media: CatalogMedia
  summary?: string
}

export type CatalogDetailSection = {
  title: string
  kind: 'overview' | 'names' | 'form' | 'preparation' | 'properties' | 'uses' | 'commentary' | 'prescriptions' | 'other'
  original: string
  translation?: string
}

export type CatalogDetail = CatalogEntry & {
  sections: CatalogDetailSection[]
  summary?: string
  retrievedAt: string
}

export type CatalogStats = {
  total: number
  matched: number
  review: number
  missing: number
  pending: number
}

export type GenerationJob = {
  id: string
  status: 'idle' | 'running' | 'complete' | 'failed' | 'stopped'
  startedAt?: string
  endedAt?: string
  total: number
  completed: number
  succeeded: number
  failed: number
  reused: number
  current?: { id: string; name: string }
  latest?: { id: string; name: string; imageUrl?: string; error?: string }
  model: string
  style?: string
  mode: string
  limit?: number
  category?: string
  overwrite: boolean
  estimatedInputTokens: number
  estimatedImageTokens: number
  estimatedTotalTokens: number
  estimatedStandardUsd: number
  estimatedBatchUsd: number
  totals?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    estimatedInputTokens?: number
    estimatedImageTokens?: number
    estimatedTotalTokens?: number
    standardUsd?: number
    batchUsd?: number
  }
  pricing?: Record<string, number>
  logs: string[]
}
