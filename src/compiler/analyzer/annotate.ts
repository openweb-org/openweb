import type { ParameterDescriptor } from '../types.js'

export interface Annotation {
  readonly operationId: string
  readonly summary: string
}

/** Curated overrides — highest priority */
const KNOWN: Record<string, Annotation> = {
  'geocoding-api.open-meteo.com /v1/search': {
    operationId: 'search_location',
    summary: 'Search for a location by name (geocoding)',
  },
  'api.open-meteo.com /v1/forecast': {
    operationId: 'get_forecast',
    summary: 'Get hourly and daily weather forecast for a location',
  },
  'archive-api.open-meteo.com /v1/archive': {
    operationId: 'get_historical',
    summary: 'Get historical weather data for a location',
  },
  'air-quality-api.open-meteo.com /v1/air-quality': {
    operationId: 'get_air_quality',
    summary: 'Get air quality data for a location',
  },
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  latitude: 'Latitude in decimal degrees.',
  longitude: 'Longitude in decimal degrees.',
  hourly: 'Hourly variables to include in the response.',
  daily: 'Daily variables to include in the response.',
  timezone: 'IANA timezone identifier.',
  start_date: 'Start date in YYYY-MM-DD format.',
  end_date: 'End date in YYYY-MM-DD format.',
  name: 'Location name query.',
  count: 'Maximum number of matched results.',
  language: 'Language code for localized names.',
  q: 'Search query string.',
  query: 'Search query string.',
  page: 'Page number for pagination.',
  per_page: 'Number of results per page.',
  limit: 'Maximum number of results.',
  offset: 'Offset for pagination.',
  sort: 'Sort order.',
  order: 'Sort direction (asc or desc).',
  id: 'Resource identifier.',
}

/** Segments that indicate "self" / singular resource */
const SINGULAR_SEGMENTS = new Set(['me', 'self', 'current', 'profile', 'settings', 'config', 'status'])

/** Segments that indicate search/query operations */
const SEARCH_SEGMENTS = new Set(['search', 'find', 'query', 'lookup', 'autocomplete', 'suggest'])

/** Version-like path segments to skip */
const VERSION_PATTERN = /^v\d+(\.\d+)?$/

/** Common noise segments to skip in ID generation */
const NOISE_SEGMENTS = new Set(['api', 'rest', 'web', 'public', 'internal', 'graphql'])

/**
 * Convert camelCase or PascalCase to snake_case.
 * e.g. "listRepoIssues" → "list_repo_issues"
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

/**
 * Detect if a word is likely plural.
 * Simple heuristic: ends with 's' but not 'ss', 'us', 'is'.
 */
function isLikelyPlural(word: string): boolean {
  if (word.length < 3) return false
  if (!word.endsWith('s')) return false
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is') || word.endsWith('as')) return false
  return true
}

/**
 * Generate a human-friendly summary from an operationId.
 * e.g. "listRepoIssues" → "List repo issues"
 */
function summaryFromId(operationId: string): string {
  const words = operationId.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Extract meaningful path segments (skip versions, noise, path params) */
function extractMeaningfulSegments(path: string): string[] {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .filter((s) => !VERSION_PATTERN.test(s))
    .filter((s) => !s.startsWith('{') && !s.endsWith('}'))
    .filter((s) => !NOISE_SEGMENTS.has(s.toLowerCase()))
}

/**
 * Heuristic operationId + summary from method + path.
 *
 * Examples:
 *   GET  /api/v1/users          → listUsers / "List users"
 *   GET  /api/v1/users/me       → getMe / "Get me"
 *   GET  /api/v1/users/{id}     → getUser / "Get user"
 *   POST /api/v1/users          → createUser / "Create user"
 *   PUT  /api/v1/users/{id}     → updateUser / "Update user"
 *   DELETE /api/v1/users/{id}   → deleteUser / "Delete user"
 *   GET  /api/v1/search         → search / "Search"
 *   GET  /repos/{owner}/{repo}/issues → listRepoIssues / "List repo issues"
 */
function heuristicAnnotation(method: string, path: string): Annotation {
  const segments = extractMeaningfulSegments(path)
  const rawSegments = path.split('/').filter((s) => s.length > 0)
  const lastRaw = rawSegments[rawSegments.length - 1] ?? ''
  const isLastPathParam = lastRaw.startsWith('{') && lastRaw.endsWith('}')

  // Determine verb prefix from HTTP method
  const methodLower = method.toLowerCase()
  let verb: string

  if (segments.length > 0 && SEARCH_SEGMENTS.has(segments[segments.length - 1]!.toLowerCase())) {
    verb = 'search'
  } else if (methodLower === 'post') {
    verb = 'create'
  } else if (methodLower === 'put' || methodLower === 'patch') {
    verb = 'update'
  } else if (methodLower === 'delete') {
    verb = 'delete'
  } else {
    // GET or HEAD — decide between "get" and "list"
    const lastSegment = segments[segments.length - 1]?.toLowerCase() ?? ''
    if (SINGULAR_SEGMENTS.has(lastSegment)) {
      verb = 'get'
    } else if (isLastPathParam) {
      verb = 'get'
    } else if (isLikelyPlural(lastSegment)) {
      verb = 'list'
    } else {
      verb = 'get'
    }
  }

  // Build the noun part from meaningful segments
  const nounSegments = segments.map((s) => s.toLowerCase())

  // If verb is "search" and last segment is "search", remove the redundant "search"
  if (verb === 'search' && nounSegments[nounSegments.length - 1] === 'search') {
    nounSegments.pop()
  }

  // Singularize when addressing a specific resource (path param at the end)
  const singularVerbs = new Set(['get', 'update', 'delete'])
  const shouldSingularize = singularVerbs.has(verb) && isLastPathParam

  let nounPart: string
  if (nounSegments.length === 0) {
    nounPart = ''
  } else if (verb === 'get' && SINGULAR_SEGMENTS.has(nounSegments[nounSegments.length - 1]!)) {
    // e.g. /users/me → getMe
    nounPart = nounSegments[nounSegments.length - 1]!
  } else if (shouldSingularize && nounSegments.length > 0) {
    // e.g. /users/{id} → getUser, deleteUser, updateUser
    const lastNoun = nounSegments[nounSegments.length - 1]!
    const singular = isLikelyPlural(lastNoun) ? lastNoun.slice(0, -1) : lastNoun
    if (nounSegments.length > 1) {
      nounPart = nounSegments.slice(0, -1).join('_') + '_' + singular
    } else {
      nounPart = singular
    }
  } else {
    nounPart = nounSegments.join('_')
  }

  const operationId = nounPart ? `${verb}_${nounPart}` : verb
  const summary = summaryFromId(operationId)

  return { operationId: toSnakeCase(operationId), summary }
}

export function annotateOperation(host: string, path: string, method = 'GET'): Annotation {
  // Curated override takes priority
  const key = `${host} ${path}`
  const known = KNOWN[key]
  if (known) return known

  return heuristicAnnotation(method, path)
}

export function annotateParameterDescriptions(params: ParameterDescriptor[]): ParameterDescriptor[] {
  return params.map((parameter) => ({
    ...parameter,
    description: PARAM_DESCRIPTIONS[parameter.name] ?? parameter.description ?? '',
  }))
}
