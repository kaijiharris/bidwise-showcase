// Server-only content loader for investor guides. Reads MDX files from
// content/guides/, parses frontmatter, and exposes a typed listing + single
// lookup. Uses node fs, so this module must only be imported from Server
// Components / route handlers — never a client component.

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const GUIDES_DIR = path.join(process.cwd(), 'content', 'guides')

export interface GuideMeta {
  slug: string
  title: string
  description: string
  category: string
  /** lucide-react icon name, mapped to a component in the UI layer. */
  icon: string
  minutes: number
  order: number
  published: boolean
  date: string
}

function parseMeta(slug: string, data: Record<string, unknown>): GuideMeta {
  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ''),
    category: String(data.category ?? 'Guide'),
    icon: String(data.icon ?? 'BookOpen'),
    minutes: Number(data.minutes ?? 5),
    order: Number(data.order ?? 999),
    published: data.published !== false,
    date: String(data.date ?? ''),
  }
}

export function getAllGuides(): GuideMeta[] {
  if (!fs.existsSync(GUIDES_DIR)) return []
  return fs
    .readdirSync(GUIDES_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(f => {
      const slug = f.replace(/\.mdx$/, '')
      const raw = fs.readFileSync(path.join(GUIDES_DIR, f), 'utf8')
      const { data } = matter(raw)
      return parseMeta(slug, data)
    })
    .filter(g => g.published)
    .sort((a, b) => a.order - b.order)
}

export function getGuide(slug: string): { meta: GuideMeta; content: string } | null {
  const file = path.join(GUIDES_DIR, `${slug}.mdx`)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  const { data, content } = matter(raw)
  return { meta: parseMeta(slug, data), content }
}
