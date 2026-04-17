#!/usr/bin/env tsx
/**
 * Phase 1 adapter inventory + classifier.
 *
 * Walks src/sites/* /openapi.yaml, finds every operation with
 * x-openweb.adapter, extracts current x-openweb flags, and classifies each
 * into a migration bucket informing Phase 3+ wave counts.
 *
 * Usage: pnpm tsx scripts/adapter-inventory.ts [--json path] [--md path]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

type Bucket =
  | 'canonical-ready'
  | 'needs-phase-1'
  | 'needs-phase-2'
  | 'graphql-persisted'
  | 'capture-simple'
  | 'capture-signed'
  | 'custom-permanent'
  | 'uncertain'

/**
 * Full-source signing / anti-bot evidence.
 *
 * Presence of any of these strings anywhere in the adapter file indicates
 * the site relies on site-specific request signing (X-Bogus/msToken for
 * TikTok, anti-bot X-s / X-s-common for Xiaohongshu, x-client-transaction-id
 * for X/Twitter, generic hmac / sha signing, etc.).
 */
const SIGNING_EVIDENCE_RE = /X-Bogus|X-Gnarly|msToken|ztca-dpop|tt-ticket-guard|tt-csrf-token|x-client-transaction-id|webmssdk|signerModuleId|anti-bot signature|X-s-common|\bX-s,|\bX-t,|hmacSign|signRequest|createHmac|patched fetch|patchWindowFetch/

/**
 * Per-op signing helpers. When a handler body calls one of these, the op
 * goes through the adapter's centralised signing path and cannot be served
 * by the generic response_capture or browser_fetch runtime primitives.
 */
/**
 * Per-op signing helpers whose name alone is a strong signal (these helpers
 * only exist in adapter files that wrap centralised signing).
 */
const PER_OP_SIGNING_CALL_RE = /\b(graphqlGet|graphqlPost|executeGraphqlGet|executeGraphqlPost|internalApiCall|signedFetch|signedRequest|signAndFetch)\s*\(/

/**
 * Generic in-file helper names — ambiguous on their own. A handler that calls
 * one of these is only custom-permanent when the surrounding adapter file
 * also carries signing / anti-bot evidence.
 */
const IN_FILE_REST_HELPER_RE = /\b(executeRest|apiCall|apiFetch|siteFetch)\s*\(/

interface OpEntry {
  site: string
  operationId: string
  method: string
  pathTemplate: string
  adapterName: string
  adapterOperation: string
  transport?: string
  requiresAuth?: boolean
  hasAuth: boolean
  hasCsrf: boolean
  hasSigning: boolean
  wrap?: string
  unwrap?: string
  extractionTypes: string[]
  permission?: string
  bucket: Bucket
  classificationReason: string
}

const SITES_DIR = path.resolve(process.cwd(), 'src/sites')

function listSites(): string[] {
  return readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

// biome-ignore lint/suspicious/noExplicitAny: OpenAPI spec shape is too open to model precisely here.
function loadSpec(site: string): any | null {
  const p = path.join(SITES_DIR, site, 'openapi.yaml')
  if (!existsSync(p)) return null
  try {
    return parseYaml(readFileSync(p, 'utf8'))
  } catch (err) {
    console.error(`[warn] failed to parse ${site}/openapi.yaml: ${(err as Error).message}`)
    return null
  }
}

function loadAdapterSources(site: string): Record<string, string> {
  const dir = path.join(SITES_DIR, site, 'adapters')
  if (!existsSync(dir)) return {}
  const sources: Record<string, string> = {}
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const name = f.replace(/\.ts$/, '')
    sources[name] = readFileSync(path.join(dir, f), 'utf8')
  }
  return sources
}

/**
 * Extract the handler body for a given operation name from an adapter source.
 * Supports the three dispatch styles seen in the repo:
 *   1. `case 'opName':` inside a switch
 *   2. `opName: async (...)` entries in an OPERATIONS record
 *   3. `async function opName(...)` / `function opName(...)` named functions
 * Returns text up to the next sibling definition (so signals from other
 * operations' handlers don't leak in).
 */
function extractHandler(source: string, op: string): string {
  if (!op) return ''
  const candidates: Array<{ start: number; end: number }> = []

  // 1. switch-case dispatch
  const caseRe = new RegExp(`case\\s+['\"]${op}['\"]\\s*:`)
  const mCase = caseRe.exec(source)
  if (mCase) {
    const tail = source.slice(mCase.index + mCase[0].length)
    const nextCase = /\n\s*case\s+['\"][^'\"]+['\"]\s*:|\n\s*default\s*:/.exec(tail)
    const end = nextCase ? mCase.index + mCase[0].length + nextCase.index : Math.min(source.length, mCase.index + 4000)
    candidates.push({ start: mCase.index, end })
  }

  // 2. OPERATIONS record: `opName: async (...)` or `opName(...) {`
  const recRe = new RegExp(`\\b${op}\\s*:\\s*(async\\s*)?\\(`)
  const mRec = recRe.exec(source)
  if (mRec) {
    const end = findBlockEnd(source, mRec.index, 5000)
    candidates.push({ start: mRec.index, end })
  }

  // 3. Named function: `async function opName` / `function opName`
  const fnRe = new RegExp(`(async\\s+function|function|const)\\s+${op}\\b`)
  const mFn = fnRe.exec(source)
  if (mFn) {
    const end = findBlockEnd(source, mFn.index, 6000)
    candidates.push({ start: mFn.index, end })
  }

  if (candidates.length === 0) {
    const idx = source.indexOf(op)
    if (idx >= 0) return source.slice(Math.max(0, idx - 100), Math.min(source.length, idx + 1500))
    return ''
  }
  // pick the widest candidate (most likely the true handler body)
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start))
  const { start, end } = candidates[0]
  return source.slice(start, end)
}

/** Find the end of the next balanced `{...}` block after `from`. Returns a capped window if braces don't balance. */
function findBlockEnd(source: string, from: number, cap: number): number {
  let depth = 0
  let seenOpen = false
  const max = Math.min(source.length, from + cap)
  for (let i = from; i < max; i++) {
    const ch = source[i]
    if (ch === '{') {
      depth++
      seenOpen = true
    } else if (ch === '}') {
      depth--
      if (seenOpen && depth <= 0) return i + 1
    }
  }
  return max
}

function classify(entry: Omit<OpEntry, 'bucket' | 'classificationReason'>, handler: string, fullSource: string): { bucket: Bucket; reason: string } {
  const h = handler || fullSource
  const siteHasSigningEvidence = SIGNING_EVIDENCE_RE.test(fullSource)

  // custom-permanent: per-op signing helper call (centralised signing in adapter)
  if (PER_OP_SIGNING_CALL_RE.test(h)) {
    return { bucket: 'custom-permanent', reason: 'per-op signing helper (graphqlGet/Post, internalApiCall, …)' }
  }
  if (siteHasSigningEvidence && IN_FILE_REST_HELPER_RE.test(h)) {
    return { bucket: 'custom-permanent', reason: 'in-file REST helper in signed adapter (executeRest, …)' }
  }

  // custom-permanent: signing / hmac present in handler vicinity
  if (/\b(signRequest|hmacSign|createHmac|createHash\(\s*['\"]sha(1|256|512)['\"])/.test(h) || /\bsignature\s*[:=]/.test(h)) {
    return { bucket: 'custom-permanent', reason: 'signing or hmac logic' }
  }

  // graphql-persisted: persisted query hash references
  if (/persistedQuery|sha256Hash|persistedQueryHash|operationHash/.test(h)) {
    return { bucket: 'graphql-persisted', reason: 'graphql persisted query / hash' }
  }

  // capture-signed vs capture-simple: navigate + intercept response pattern,
  // split by whether the adapter file exhibits signing / anti-bot evidence.
  // Signed captures cannot be served by a blank-page response_capture run —
  // the interesting request only fires after the site's own JS signs it.
  if (/interceptApi|page\.on\(\s*['\"]response['\"]|page\.waitForResponse/.test(h)) {
    if (siteHasSigningEvidence) {
      return { bucket: 'capture-signed', reason: 'navigate + intercept with signing / anti-bot evidence' }
    }
    return { bucket: 'capture-simple', reason: 'navigate + intercept response' }
  }

  // needs-phase-2: SSR/script scraping or page_global extraction
  if (/__NEXT_DATA__|nextDataJson|ssr_next_data|page_global_data|\$\(?\s*['\"]script/.test(h)) {
    return { bucket: 'needs-phase-2', reason: 'script_json / ssr extraction' }
  }
  if (entry.extractionTypes.some((t) => t === 'ssr_next_data' || t === 'script_json' || t === 'page_global_data')) {
    return { bucket: 'needs-phase-2', reason: `extraction: ${entry.extractionTypes.join(',')}` }
  }

  // multi-step page flow — suggests PagePlan (Phase 1)
  const gotoCount = (h.match(/page\.goto\(/g) || []).length
  const hasDomScrape = /page\.\$\(|page\.\$\$\(|page\.locator\(|page\.evaluate\(/.test(h)
  if (gotoCount >= 2 || (gotoCount >= 1 && hasDomScrape)) {
    return { bucket: 'needs-phase-1', reason: 'multi-step page navigation / DOM scrape' }
  }

  // Graphql body POST but not persisted — adapter helper candidate (Phase 2)
  const fetchCount = (h.match(/\bfetch\(/g) || []).length
  if (/graphql|\/graph\b|operationName\s*:/i.test(h) && fetchCount >= 1) {
    return { bucket: 'needs-phase-2', reason: 'graphql inline query — adapter helper candidate' }
  }

  // Fetch wrapper — likely canonical-ready after minor spec tweak
  if (fetchCount >= 1 && !hasDomScrape && gotoCount === 0) {
    return { bucket: 'canonical-ready', reason: 'fetch-based handler, no page or DOM work' }
  }

  // Node transport with no page/DOM/signing/graphql signals — the HTTP executor
  // already handles the transport; thin wrappers (e.g. PDS helpers) map 1:1 to spec.
  if (entry.transport === 'node' && !hasDomScrape && gotoCount === 0) {
    return { bucket: 'canonical-ready', reason: 'node transport, thin wrapper (helper-based HTTP)' }
  }

  // Page transport with no fetch/goto/DOM signal — small wrappers usually
  // need PagePlan once the runtime takes over; flag as Phase 1 unless tiny.
  if (entry.transport === 'page') {
    return { bucket: 'needs-phase-1', reason: 'page transport, no strong capture/graphql/SSR signal' }
  }

  return { bucket: 'uncertain', reason: 'no strong signal' }
}

// biome-ignore lint/suspicious/noExplicitAny: reads arbitrary x-openweb extension bag.
function extractXOpenWeb(op: any): Partial<OpEntry> {
  const xo = op?.['x-openweb'] || {}
  const extractionTypes: string[] = []
  const extraction = xo.extraction
  if (Array.isArray(extraction)) {
    for (const e of extraction) if (e?.type) extractionTypes.push(e.type)
  } else if (extraction?.type) {
    extractionTypes.push(extraction.type)
  }
  return {
    transport: xo.transport,
    requiresAuth: xo.requires_auth,
    hasAuth: !!xo.auth,
    hasCsrf: !!xo.csrf,
    hasSigning: !!xo.signing,
    wrap: xo.wrap,
    unwrap: xo.unwrap,
    extractionTypes,
    permission: xo.permission,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: reads arbitrary x-openweb extension bag.
function collectServerXOpenWeb(spec: any): { transport?: string } {
  const servers = Array.isArray(spec?.servers) ? spec.servers : []
  for (const s of servers) {
    const xo = s?.['x-openweb']
    if (xo?.transport) return { transport: xo.transport }
  }
  return {}
}

function walk(): OpEntry[] {
  const entries: OpEntry[] = []
  for (const site of listSites()) {
    const spec = loadSpec(site)
    if (!spec?.paths) continue
    const adapterSources = loadAdapterSources(site)
    const serverDefaults = collectServerXOpenWeb(spec)
    // biome-ignore lint/suspicious/noExplicitAny: path item entries are untyped OpenAPI objects.
    for (const [pathTemplate, item] of Object.entries<any>(spec.paths)) {
      if (!item || typeof item !== 'object') continue
      for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        const op = item[method]
        if (!op) continue
        const xo = op['x-openweb']
        const adapter = xo?.adapter
        if (!adapter?.name) continue
        const xoFields = extractXOpenWeb(op) as OpEntry
        const src = adapterSources[adapter.name] || Object.values(adapterSources)[0] || ''
        const handler = extractHandler(src, adapter.operation || op.operationId || '')
        const partial: Omit<OpEntry, 'bucket' | 'classificationReason'> = {
          site,
          operationId: op.operationId || '(unknown)',
          method: method.toUpperCase(),
          pathTemplate,
          adapterName: adapter.name,
          adapterOperation: adapter.operation || op.operationId || '',
          transport: xoFields.transport || serverDefaults.transport,
          requiresAuth: xoFields.requiresAuth,
          hasAuth: !!xoFields.hasAuth,
          hasCsrf: !!xoFields.hasCsrf,
          hasSigning: !!xoFields.hasSigning,
          wrap: xoFields.wrap,
          unwrap: xoFields.unwrap,
          extractionTypes: xoFields.extractionTypes || [],
          permission: xoFields.permission,
        }
        const { bucket, reason } = classify(partial, handler, src)
        entries.push({ ...partial, bucket, classificationReason: reason })
      }
    }
  }
  return entries
}

function renderMarkdown(entries: OpEntry[]): string {
  const total = entries.length
  const byBucket = new Map<Bucket, number>()
  const bySite = new Map<string, number>()
  const perSiteBucket = new Map<string, Map<Bucket, number>>()
  for (const e of entries) {
    byBucket.set(e.bucket, (byBucket.get(e.bucket) || 0) + 1)
    bySite.set(e.site, (bySite.get(e.site) || 0) + 1)
    const row = perSiteBucket.get(e.site) || new Map<Bucket, number>()
    row.set(e.bucket, (row.get(e.bucket) || 0) + 1)
    perSiteBucket.set(e.site, row)
  }
  const bucketOrder: Bucket[] = [
    'canonical-ready',
    'capture-simple',
    'capture-signed',
    'graphql-persisted',
    'needs-phase-1',
    'needs-phase-2',
    'custom-permanent',
    'uncertain',
  ]

  let md = "# Adapter Inventory — Phase 1\n\n"
  md += "Generated by \`pnpm tsx scripts/adapter-inventory.ts\`.\n\n"
  md += `Total adapter-backed operations: **${total}**\n\n`
  md += "## Per-bucket counts\n\n"
  md += "| Bucket | Count | % |\n|---|---:|---:|\n"
  for (const b of bucketOrder) {
    const c = byBucket.get(b) || 0
    const pct = total ? ((c / total) * 100).toFixed(1) : '0.0'
    md += `| ${b} | ${c} | ${pct}% |\n`
  }
  md += "\n## Top 30 sites by adapter op count\n\n"
  const sortedSites = [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  md += `| Site | Total | ${bucketOrder.join(' | ')} |\n`
  md += `|---|---:|${bucketOrder.map(() => '---:').join('|')}|\n`
  for (const [site, count] of sortedSites) {
    const row = perSiteBucket.get(site) || new Map()
    md += `| ${site} | ${count} | ${bucketOrder.map((b) => row.get(b) || 0).join(' | ')} |\n`
  }
  md += "\n## Bucket definitions\n\n"
  md += "- **canonical-ready**: spec can represent the operation directly; adapter removable with minor spec tweak.\n"
  md += "- **capture-simple**: navigate + intercept first matching response (fits \`response_capture\`).\n"
  md += "- **capture-signed**: navigate + intercept where the site requires request signing / anti-bot tokens (X-Bogus, X-s-common, x-client-transaction-id). A blank-page \`response_capture\` run cannot serve these — the signed request only fires after the site's own JS executes.\n"
  md += "- **graphql-persisted**: static GraphQL query or persisted hash (fits \`graphql_hash\`).\n"
  md += "- **needs-phase-1**: requires PagePlan, server variables, or request parity work.\n"
  md += "- **needs-phase-2**: requires \`script_json\` extensions, \`response_capture\`, adapter helpers, or \`graphql_hash\` infrastructure beyond current support.\n"
  md += "- **custom-permanent**: permanent custom bucket — per-op signing helpers (graphqlGet/Post, internalApiCall) or hmac/sha signing logic in the handler body.\n"
  md += "- **uncertain**: needs manual review.\n"
  md += "\n## Notes & caveats\n\n"
  md += "- Classification is heuristic; it reads per-operation handler bodies from the adapter \`.ts\` files and looks for strong signals (\`interceptApi\`, \`persistedQuery\`, \`__NEXT_DATA__\`, \`fetch\`, \`page.goto\`, signing primitives, centralised signing helpers).\n"
  md += "- \`custom-permanent\` fires when the handler body calls a per-op signing helper (\`graphqlGet\`, \`graphqlPost\`, \`executeGraphqlGet\`, \`executeGraphqlPost\`, \`internalApiCall\`, \`signedFetch\`) or contains direct hmac/sha signing logic.\n"
  md += "- \`capture-signed\` fires when a navigate+intercept handler lives in an adapter file that also contains signing / anti-bot evidence (e.g. \`X-Bogus\`, \`msToken\`, \`X-s-common\`, \`x-client-transaction-id\`, \`patched fetch\`). Such ops need the site's own runtime to fire the signed request — generic \`response_capture\` on a blank page cannot reproduce them.\n"
  md += "- \`needs-phase-1\` is the fallback for page-transport operations without capture / graphql / SSR signals; expect manual triage during wave planning.\n"
  md += "- Run \`pnpm tsx scripts/adapter-inventory.ts --json inventory.json\` for the full per-op listing (JSON), or pipe the stdout table.\n"
  return md
}

function main() {
  const args = process.argv.slice(2)
  let jsonPath = ''
  let mdPath = 'doc/todo/normalize-adapter/inventory.md'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') jsonPath = args[++i]
    else if (args[i] === '--md') mdPath = args[++i]
  }

  const entries = walk()
  entries.sort((a, b) => a.site.localeCompare(b.site) || a.operationId.localeCompare(b.operationId))

  // Console summary + per-op lines
  const counts = new Map<Bucket, number>()
  for (const e of entries) counts.set(e.bucket, (counts.get(e.bucket) || 0) + 1)
  console.log(`adapter-backed operations: ${entries.length}`)
  for (const [b, c] of [...counts.entries()].sort()) console.log(`  ${b}: ${c}`)
  console.log('---')
  for (const e of entries) {
    console.log(
      `${e.site}\t${e.operationId}\t${e.adapterName}.${e.adapterOperation}\ttransport=${e.transport || '-'}\tauth=${e.hasAuth ? 'y' : 'n'}\tcsrf=${e.hasCsrf ? 'y' : 'n'}\tsigning=${e.hasSigning ? 'y' : 'n'}\textract=${e.extractionTypes.join(',') || '-'}\tbucket=${e.bucket}\t(${e.classificationReason})`,
    )
  }

  if (jsonPath) {
    mkdirSync(path.dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, JSON.stringify(entries, null, 2))
    console.log(`wrote ${jsonPath}`)
  }
  if (mdPath) {
    mkdirSync(path.dirname(mdPath), { recursive: true })
    writeFileSync(mdPath, renderMarkdown(entries))
    console.log(`wrote ${mdPath}`)
  }
}

main()
