import type { PageSnapshot } from './page-snapshot.js'

// --- Intent types ---

export type ReadIntent = 'profile' | 'feed' | 'search' | 'detail' | 'social' | 'activity' | 'meta'
export type WriteIntent = 'create' | 'react' | 'update' | 'transact' | 'delete'
export type Intent = ReadIntent | WriteIntent

export interface IntentMatch {
  readonly intent: Intent
  readonly confidence: 'high' | 'medium' | 'low'
  readonly source: 'api' | 'page_structure' | 'both'
  readonly evidence: string
}

export interface IntentGap {
  readonly intent: Intent
  readonly suggestion: string
}

export interface IntentAnalysis {
  readonly matched: IntentMatch[]
  readonly gaps: IntentGap[]
}

// --- Captured path info (from filtered samples) ---

export interface CapturedPath {
  readonly path: string
  readonly method: string
}

// --- API path → intent heuristics ---

const API_INTENT_PATTERNS: ReadonlyArray<{ intent: Intent; patterns: readonly RegExp[] }> = [
  { intent: 'profile', patterns: [/\/(me|profile|user|account|settings)\b/i] },
  { intent: 'feed', patterns: [/\/(feed|timeline|home|trending|recommended|popular|hot|top|latest|new)\b/i] },
  { intent: 'search', patterns: [/\/(search|query|find|autocomplete|suggest|lookup)\b/i] },
  { intent: 'social', patterns: [/\/(friends|followers|following|contacts|messages|chat|dm|conversations)\b/i] },
  { intent: 'activity', patterns: [/\/(notifications|activity|history|events|log)\b/i] },
  { intent: 'meta', patterns: [/\/(categories|tags|config|metadata|info|status|version|health)\b/i] },
  { intent: 'create', patterns: [/\/(create|new|post|publish|submit|compose|upload)\b/i] },
  { intent: 'react', patterns: [/\/(like|favorite|bookmark|star|vote|react|upvote|downvote)\b/i] },
  { intent: 'update', patterns: [/\/(edit|update|modify|patch)\b/i] },
  { intent: 'transact', patterns: [/\/(cart|checkout|purchase|buy|order|book|subscribe|pay)\b/i] },
  { intent: 'delete', patterns: [/\/(delete|remove|destroy|archive|trash)\b/i] },
  // detail is last: broad /{resource}/{id} pattern, should not shadow specific intents
  { intent: 'detail', patterns: [/\/[a-z_-]+\/[^/]+$/i] },
]

// Non-GET methods strongly imply write intents
const METHOD_INTENT_MAP: Readonly<Record<string, WriteIntent>> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
}

// --- Page structure → intent heuristics ---

const NAV_TEXT_PATTERNS: ReadonlyArray<{ intent: Intent; patterns: readonly RegExp[] }> = [
  { intent: 'profile', patterns: [/\b(profile|settings|account|my\s?\w+)\b/i] },
  { intent: 'feed', patterns: [/\b(home|feed|timeline|explore|discover|browse)\b/i] },
  { intent: 'search', patterns: [/\b(search|find)\b/i] },
  { intent: 'social', patterns: [/\b(friends|followers|contacts|messages|chat|inbox|mail)\b/i] },
  { intent: 'activity', patterns: [/\b(notifications|activity|history|alerts)\b/i] },
  { intent: 'meta', patterns: [/\b(categories|tags|about|help|faq|docs|api)\b/i] },
]

const BUTTON_TEXT_PATTERNS: ReadonlyArray<{ intent: WriteIntent; patterns: readonly RegExp[] }> = [
  { intent: 'create', patterns: [/\b(post|send|submit|create|publish|compose|new|write|tweet|reply)\b/i] },
  { intent: 'react', patterns: [/\b(like|love|favorite|star|bookmark|upvote|downvote)\b/i] },
  { intent: 'transact', patterns: [/\b(add\s*to\s*cart|buy|purchase|checkout|order|book|subscribe|pay)\b/i] },
  { intent: 'delete', patterns: [/\b(delete|remove|destroy)\b/i] },
]

// --- Core analysis ---

export function matchIntentsFromApi(paths: CapturedPath[]): IntentMatch[] {
  const matched: IntentMatch[] = []
  const seenIntents = new Set<Intent>()

  for (const { path, method } of paths) {
    // Path-based matching
    for (const { intent, patterns } of API_INTENT_PATTERNS) {
      if (seenIntents.has(intent)) continue
      if (patterns.some((p) => p.test(path))) {
        // 'detail' pattern is very broad — low confidence unless clearly structured
        const confidence = intent === 'detail' ? 'low' : 'high'
        seenIntents.add(intent)
        matched.push({ intent, confidence, source: 'api', evidence: `${method} ${path}` })
      }
    }

    // Method-based matching for write intents
    const upperMethod = method.toUpperCase()
    const writeIntent = METHOD_INTENT_MAP[upperMethod]
    if (writeIntent && !seenIntents.has(writeIntent)) {
      seenIntents.add(writeIntent)
      matched.push({ intent: writeIntent, confidence: 'medium', source: 'api', evidence: `${method} ${path}` })
    }
  }

  return matched
}

function matchIntentsFromPage(snapshot: PageSnapshot): IntentMatch[] {
  const matched: IntentMatch[] = []
  const seenIntents = new Set<Intent>()

  // Nav link text
  for (const link of snapshot.navLinks) {
    for (const { intent, patterns } of NAV_TEXT_PATTERNS) {
      if (seenIntents.has(intent)) continue
      if (patterns.some((p) => p.test(link.text))) {
        seenIntents.add(intent)
        matched.push({ intent, confidence: 'medium', source: 'page_structure', evidence: `nav link "${link.text}"` })
      }
    }
  }

  // Search inputs → search intent
  if (snapshot.searchInputs.length > 0 && !seenIntents.has('search')) {
    seenIntents.add('search')
    matched.push({
      intent: 'search',
      confidence: 'high',
      source: 'page_structure',
      evidence: `search input (${snapshot.searchInputs[0]?.placeholder || snapshot.searchInputs[0]?.selector})`,
    })
  }

  // Button text
  for (const btn of snapshot.buttons) {
    for (const { intent, patterns } of BUTTON_TEXT_PATTERNS) {
      if (seenIntents.has(intent)) continue
      if (patterns.some((p) => p.test(btn.text))) {
        seenIntents.add(intent)
        matched.push({ intent, confidence: 'medium', source: 'page_structure', evidence: `button "${btn.text}"` })
      }
    }
  }

  // Forms with POST → create intent
  for (const form of snapshot.forms) {
    if (form.method === 'POST' && !seenIntents.has('create')) {
      seenIntents.add('create')
      matched.push({
        intent: 'create',
        confidence: 'low',
        source: 'page_structure',
        evidence: `form POST ${form.action || '(inline)'}`,
      })
    }
  }

  return matched
}

function buildGaps(apiMatches: IntentMatch[], pageMatches: IntentMatch[]): IntentGap[] {
  const apiIntents = new Set(apiMatches.map((m) => m.intent))
  const gaps: IntentGap[] = []

  for (const match of pageMatches) {
    if (apiIntents.has(match.intent)) continue
    // Page structure suggests this intent exists, but no API captured for it
    gaps.push({
      intent: match.intent,
      suggestion: suggestAction(match),
    })
  }

  return gaps
}

function suggestAction(match: IntentMatch): string {
  switch (match.intent) {
    case 'search': return 'submit a search query'
    case 'profile': return `click "${extractQuotedText(match.evidence)}" link`
    case 'feed': return `click "${extractQuotedText(match.evidence)}" link`
    case 'social': return `click "${extractQuotedText(match.evidence)}" link`
    case 'activity': return `click "${extractQuotedText(match.evidence)}" link`
    case 'meta': return `click "${extractQuotedText(match.evidence)}" link`
    case 'create': return `interact with "${extractQuotedText(match.evidence)}" control`
    case 'react': return `interact with "${extractQuotedText(match.evidence)}" control`
    case 'transact': return `interact with "${extractQuotedText(match.evidence)}" control`
    case 'delete': return `interact with "${extractQuotedText(match.evidence)}" control`
    default: return `explore page for ${match.intent}`
  }
}

function extractQuotedText(evidence: string): string {
  const match = evidence.match(/"([^"]+)"/)
  return match?.[1] ?? evidence
}

/**
 * Analyze captured API operations and page structure to determine
 * intent coverage and identify gaps for targeted exploration.
 */
export function analyzeIntents(snapshot: PageSnapshot, capturedPaths: CapturedPath[]): IntentAnalysis {
  const apiMatches = matchIntentsFromApi(capturedPaths)
  const pageMatches = matchIntentsFromPage(snapshot)

  // Merge: if both API and page agree, upgrade to 'both' source
  const merged: IntentMatch[] = []
  const mergedIntents = new Set<Intent>()

  for (const api of apiMatches) {
    const pageMatch = pageMatches.find((p) => p.intent === api.intent)
    if (pageMatch) {
      merged.push({ ...api, source: 'both', confidence: 'high' })
    } else {
      merged.push(api)
    }
    mergedIntents.add(api.intent)
  }

  // Page-only matches
  for (const page of pageMatches) {
    if (!mergedIntents.has(page.intent)) {
      merged.push(page)
      mergedIntents.add(page.intent)
    }
  }

  const gaps = buildGaps(apiMatches, pageMatches)

  return { matched: merged, gaps }
}
