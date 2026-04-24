import type { CustomRunner, PreparedContext } from '../../../types/adapter.js'

const ARXIV_API = 'https://export.arxiv.org/api/query'
const ARXIV_ABS = 'https://arxiv.org/abs'

// ── Query preprocessing ──────────────────────────────────────────────
// arXiv uses Lucene syntax where spaces default to OR. Users expect AND.
// Auto-AND terms when the query has no explicit boolean operators.

const BOOL_RE = /\b(AND|OR|ANDNOT)\b/

function preprocessQuery(raw: string): string {
  if (BOOL_RE.test(raw)) return raw
  if (!raw.includes(' ')) return raw

  const tokens = raw.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return raw

  let currentPrefix = 'all'
  const parts: string[] = []
  for (const tok of tokens) {
    const colonIdx = tok.indexOf(':')
    if (colonIdx > 0 && /^[a-z_]+$/.test(tok.slice(0, colonIdx))) {
      currentPrefix = tok.slice(0, colonIdx)
      parts.push(tok)
    } else {
      parts.push(`${currentPrefix}:${tok}`)
    }
  }
  return parts.join(' AND ')
}

// ── XML parsing ──────────────────────────────────────────────────────

function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)
  const m = xml.match(re)
  return m ? m[1].trim() : undefined
}

function xmlAttr(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*?${attr}="([^"]*)"`)
  const m = xml.match(re)
  return m ? m[1] : undefined
}

interface ArxivPaper {
  id: string
  title: string
  abstract: string
  authors: string[]
  published: string
  updated: string
  primary_category: string
  categories: string[]
  pdf_url: string
  abstract_url: string
  comment?: string
  journal_ref?: string
  doi?: string
}

function parseEntries(xml: string): ArxivPaper[] {
  const entries: ArxivPaper[] = []
  const entryBlocks = xml.split('<entry>').slice(1)

  for (const block of entryBlocks) {
    const entry = block.split('</entry>')[0]

    const rawId = xmlTag(entry, 'id') ?? ''
    const id = rawId.replace('http://arxiv.org/abs/', '').replace('https://arxiv.org/abs/', '')

    const title = (xmlTag(entry, 'title') ?? '').replace(/\s+/g, ' ')
    const abstract = (xmlTag(entry, 'summary') ?? '').replace(/\s+/g, ' ')
    const published = xmlTag(entry, 'published') ?? ''
    const updated = xmlTag(entry, 'updated') ?? ''

    const authors: string[] = []
    for (const m of entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)) {
      authors.push(m[1].trim())
    }

    const primaryCat = xmlAttr(entry, 'arxiv:primary_category', 'term') ?? ''
    const categories: string[] = []
    for (const m of entry.matchAll(/<category\s+term="([^"]+)"/g)) {
      categories.push(m[1])
    }

    const pdfMatch = entry.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/)
      ?? entry.match(/<link[^>]+href="([^"]+)"[^>]+title="pdf"/)
    const pdf_url = pdfMatch?.[1] ?? `https://arxiv.org/pdf/${id}`

    const absMatch = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)
      ?? entry.match(/<link[^>]+href="([^"]+)"[^>]+rel="alternate"/)
    const abstract_url = absMatch?.[1] ?? `https://arxiv.org/abs/${id}`

    const comment = xmlTag(entry, 'arxiv:comment')
    const journal_ref = xmlTag(entry, 'arxiv:journal_ref')
    const doi = xmlTag(entry, 'arxiv:doi')

    const paper: ArxivPaper = {
      id, title, abstract, authors, published, updated,
      primary_category: primaryCat, categories, pdf_url, abstract_url,
    }
    if (comment) paper.comment = comment
    if (journal_ref) paper.journal_ref = journal_ref
    if (doi) paper.doi = doi

    entries.push(paper)
  }
  return entries
}

function parseTotalResults(xml: string): number {
  const m = xml.match(/<opensearch:totalResults>(\d+)</)
  return m ? Number(m[1]) : 0
}

// ── HTML abstract parsing ────────────────────────────────────────────

function htmlText(html: string, re: RegExp): string {
  const m = html.match(re)
  if (!m) return ''
  return m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim()
}

function parseAbstractPage(html: string, arxivId: string) {
  const title = htmlText(html, /<h1 class="title[^"]*">\s*(?:<span[^>]*>[^<]*<\/span>)?\s*([\s\S]*?)<\/h1>/)
  const abstract = htmlText(html, /<blockquote class="abstract[^"]*">\s*(?:<span[^>]*>[^<]*<\/span>)?\s*([\s\S]*?)<\/blockquote>/)

  const authors: string[] = []
  const authBlock = html.match(/<div class="authors">([\s\S]*?)<\/div>/)
  if (authBlock) {
    for (const m of authBlock[1].matchAll(/>([^<]+)</g)) {
      const name = m[1].trim().replace(/^,\s*/, '')
      if (name && name !== 'Authors:') authors.push(name)
    }
  }

  const categories: string[] = []
  const catBlock = html.match(/class="tablecell subjects">([\s\S]*?)<\/td>/)
  if (catBlock) {
    for (const m of catBlock[1].matchAll(/\(([^)]+)\)/g)) {
      categories.push(m[1])
    }
  }

  const submitted = htmlText(html, /\[Submitted on ([^\]]+)\]/)
  const doi = html.match(/data-doi="([^"]+)"/)?.[1]
  const comment = htmlText(html, /<td class="tablecell comments[^"]*">([\s\S]*?)<\/td>/)

  return {
    id: arxivId,
    title,
    abstract,
    authors,
    categories,
    submitted: submitted || undefined,
    pdf_url: `https://arxiv.org/pdf/${arxivId}`,
    abstract_url: `https://arxiv.org/abs/${arxivId}`,
    ...(doi && { doi }),
    ...(comment && { comment }),
  }
}

// ── Operation handlers ───────────────────────────────────────────────

async function searchPapers(params: Readonly<Record<string, unknown>>) {
  const rawQuery = String(params.search_query ?? '')
  if (!rawQuery) throw new Error('Missing required parameter: search_query')

  const query = preprocessQuery(rawQuery)
  const url = new URL(ARXIV_API)
  url.searchParams.set('search_query', query)
  if (params.max_results != null) url.searchParams.set('max_results', String(params.max_results))
  if (params.start != null) url.searchParams.set('start', String(params.start))
  if (params.sortBy) url.searchParams.set('sortBy', String(params.sortBy))
  if (params.sortOrder) url.searchParams.set('sortOrder', String(params.sortOrder))

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`arXiv API returned ${res.status}`)
  const xml = await res.text()

  return {
    total_results: parseTotalResults(xml),
    papers: parseEntries(xml),
  }
}

async function getPaper(params: Readonly<Record<string, unknown>>) {
  const idList = String(params.id_list ?? '')
  if (!idList) throw new Error('Missing required parameter: id_list')

  const url = new URL(ARXIV_API)
  url.searchParams.set('id_list', idList)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`arXiv API returned ${res.status}`)
  const xml = await res.text()

  const papers = parseEntries(xml)
  return papers.length === 1 ? papers[0] : papers
}

async function getAbstract(params: Readonly<Record<string, unknown>>) {
  const arxivId = String(params.arxiv_id ?? '')
  if (!arxivId) throw new Error('Missing required parameter: arxiv_id')

  const res = await fetch(`${ARXIV_ABS}/${arxivId}`)
  if (!res.ok) throw new Error(`arXiv returned ${res.status}`)
  const html = await res.text()

  return parseAbstractPage(html, arxivId)
}

// ── Adapter export ───────────────────────────────────────────────────

const OPERATIONS: Record<string, (params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchPapers,
  getPaper,
  getAbstract,
}

const adapter: CustomRunner = {
  name: 'arxiv',
  description: 'arXiv paper search and metadata — node-direct with XML/HTML → JSON parsing',
  async run(ctx: PreparedContext) {
    const handler = OPERATIONS[ctx.operation]
    if (!handler) throw ctx.helpers.errors.unknownOp(ctx.operation)
    return handler(ctx.params)
  },
}

export default adapter
