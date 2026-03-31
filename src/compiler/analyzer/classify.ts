import type { HarEntry, StateSnapshot } from '../../capture/types.js'
import type { Transport } from '../../types/extensions.js'
import type { AuthPrimitive, CsrfPrimitive, SigningPrimitive } from '../../types/primitives.js'

import { detectCookieSession, detectExchangeChain, detectLocalStorageJwt } from './auth-detect.js'
import { detectCookieToHeader, detectMetaTag } from './csrf-detect.js'
import { detectSapisidhash } from './signing-detect.js'

export interface ExtractionSignal {
  readonly type: 'ssr_next_data' | 'script_json' | 'page_global'
  readonly selector?: string
  readonly id?: string
  readonly dataType?: string
  readonly globalName?: string
  readonly estimatedSize?: number
}

export interface ClassifyResult {
  readonly transport: Transport
  readonly auth?: AuthPrimitive
  readonly csrf?: CsrfPrimitive
  readonly signing?: SigningPrimitive
  readonly extractions?: readonly ExtractionSignal[]
}

export interface CaptureData {
  readonly harEntries: readonly HarEntry[]
  readonly stateSnapshots: readonly StateSnapshot[]
  readonly domHtml?: string
}

/**
 * Detect ssr_next_data: HTML contains a `<script id="__NEXT_DATA__">` tag.
 * Returns extraction signal with estimated JSON size.
 */
function detectSsrNextData(data: CaptureData): ExtractionSignal | undefined {
  const html = data.domHtml ?? getHtmlFromHar(data)
  if (!html) return undefined

  const match = /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>/i.exec(html)
  if (!match) return undefined

  // Estimate payload size from closing tag position
  const startIdx = match.index + match[0].length
  const endIdx = html.indexOf('</script>', startIdx)
  const estimatedSize = endIdx > startIdx ? endIdx - startIdx : 0

  return { type: 'ssr_next_data', selector: 'script#__NEXT_DATA__', estimatedSize }
}

/**
 * Detect script_json: HTML contains `<script type="application/json">` tags
 * (excluding __NEXT_DATA__ which is handled separately).
 * Returns all detected script_json signals.
 */
function detectScriptJson(data: CaptureData): ExtractionSignal[] {
  const html = data.domHtml ?? getHtmlFromHar(data)
  if (!html) return []

  const signals: ExtractionSignal[] = []
  const regex = /<script\s+([^>]*)type="application\/json"([^>]*)>/gi

  for (let match = regex.exec(html); match !== null; match = regex.exec(html)) {
    const attrs = (match[1] ?? '') + (match[2] ?? '')

    // Skip __NEXT_DATA__ — handled by detectSsrNextData
    if (/id="__NEXT_DATA__"/i.test(attrs)) continue

    const idMatch = /id="([^"]+)"/i.exec(attrs)
    const dataTargetMatch = /data-target="([^"]+)"/i.exec(attrs)

    const startIdx = match.index + match[0].length
    const endIdx = html.indexOf('</script>', startIdx)
    const estimatedSize = endIdx > startIdx ? endIdx - startIdx : 0

    // Only report tags with non-trivial content
    if (estimatedSize < 10) continue

    signals.push({
      type: 'script_json',
      id: idMatch?.[1] ?? undefined,
      selector: idMatch?.[1] ? `script#${idMatch[1]}` : (dataTargetMatch?.[1] ? `script[data-target="${dataTargetMatch[1]}"]` : undefined),
      dataType: dataTargetMatch?.[1] ?? undefined,
      estimatedSize,
    })
  }

  return signals
}

/**
 * Detect page_global: HTML contains window.__VAR__ = ... assignments.
 * Matches common SSR patterns like __INITIAL_STATE__, __NUXT__, __NUXT_DATA__, etc.
 */
function detectPageGlobals(data: CaptureData): ExtractionSignal[] {
  const html = data.domHtml ?? getHtmlFromHar(data)
  if (!html) return []

  const signals: ExtractionSignal[] = []
  const regex = /window\.((__[A-Z][A-Z0-9_]*__?))\s*=/g
  const seen = new Set<string>()
  for (let m = regex.exec(html); m; m = regex.exec(html)) {
    const name = m[1]
    if (!name || seen.has(name)) continue
    seen.add(name)
    signals.push({ type: 'page_global', globalName: name })
  }
  return signals
}

/** Extract HTML from HAR entries (for sites where domHtml isn't provided separately). */
function getHtmlFromHar(data: CaptureData): string | undefined {
  for (const entry of data.harEntries) {
    if (
      entry.request.method === 'GET' &&
      entry.response.status === 200 &&
      entry.response.content.mimeType.includes('text/html') &&
      entry.response.content.text
    ) {
      return entry.response.content.text
    }
  }
  return undefined
}

/**
 * Classify capture data to detect L2 primitives.
 * Returns mode + auth + csrf + signing configuration for x-openweb emission.
 *
 * Auth priority: localStorage_jwt > exchange_chain > cookie_session
 */
export function classify(data: CaptureData): ClassifyResult {
  const localStorageJwt = detectLocalStorageJwt(data)
  const exchangeChain = detectExchangeChain(data)
  const hasCookieSession = detectCookieSession(data)
  const cookieToHeader = detectCookieToHeader(data)
  const metaTag = detectMetaTag(data)
  const sapisidhash = detectSapisidhash(data)

  // Detect extraction patterns
  const extractionSignals: ExtractionSignal[] = []
  const ssrNextData = detectSsrNextData(data)
  if (ssrNextData) extractionSignals.push(ssrNextData)
  extractionSignals.push(...detectScriptJson(data))
  extractionSignals.push(...detectPageGlobals(data))
  const extractions = extractionSignals.length > 0 ? extractionSignals : undefined

  // Build signing primitive if detected
  const signing: SigningPrimitive | undefined = sapisidhash
    ? { type: 'sapisidhash', origin: sapisidhash.origin, inject: { header: 'Authorization', prefix: 'SAPISIDHASH ' } }
    : undefined

  // Priority: localStorage_jwt > exchange_chain > cookie_session
  let auth: AuthPrimitive | undefined
  if (localStorageJwt) {
    auth = {
      type: 'localStorage_jwt',
      key: localStorageJwt.key,
      path: localStorageJwt.path,
      inject: localStorageJwt.inject,
    }
  } else if (exchangeChain) {
    auth = {
      type: 'exchange_chain',
      steps: exchangeChain.steps.map(s => ({ call: s.call, extract: s.extract })),
      inject: exchangeChain.inject,
    }
  } else if (hasCookieSession) {
    auth = { type: 'cookie_session' }
  }

  if (!auth) {
    if (signing) {
      return { transport: 'node', signing, extractions }
    }
    return { transport: 'node', extractions }
  }

  // Prefer cookie_to_header over meta_tag if both detected
  const csrf = cookieToHeader
    ? { type: 'cookie_to_header' as const, cookie: cookieToHeader.cookie, header: cookieToHeader.header }
    : metaTag
      ? { type: 'meta_tag' as const, name: metaTag.name, header: metaTag.header }
      : undefined

  return {
    transport: 'node',
    auth,
    csrf,
    signing,
    extractions,
  }
}
