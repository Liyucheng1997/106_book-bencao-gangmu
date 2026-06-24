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
  sourcePage?: string
  license?: string
  artist?: string
  matchedTitle?: string
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
}

export type CatalogDetailSection = {
  title: string
  kind: 'overview' | 'names' | 'form' | 'preparation' | 'properties' | 'uses' | 'commentary' | 'prescriptions' | 'other'
  content: string
}

export type CatalogDetail = CatalogEntry & {
  sections: CatalogDetailSection[]
  retrievedAt: string
}

export type CatalogStats = {
  total: number
  matched: number
  review: number
  missing: number
  pending: number
}
