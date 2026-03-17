/**
 * Discovery benchmark site configurations.
 * 20 public sites — no auth required.
 * All sites have web UIs that generate API traffic on page load
 * (pure API endpoints without UIs are excluded — they require scripted capture).
 * Success = ≥1 operation discovered that returns 2xx when executed.
 */
export interface BenchmarkSite {
  readonly name: string
  readonly url: string
  /** Expected to find at least one operation matching this path pattern */
  readonly expectedPathHint?: string
}

export const benchmarkSites: BenchmarkSite[] = [
  // ── Existing fixtures (rediscovery validation) ──
  { name: 'catfact', url: 'https://catfact.ninja', expectedPathHint: '/fact' },
  { name: 'pokeapi', url: 'https://pokeapi.co', expectedPathHint: '/api/v2/pokemon' },
  { name: 'randomuser', url: 'https://randomuser.me', expectedPathHint: '/api' },
  { name: 'httpbin', url: 'https://httpbin.org', expectedPathHint: '/get' },
  { name: 'dogceo', url: 'https://dog.ceo', expectedPathHint: '/api' },

  // ── Sites with web UIs that generate API traffic ──
  { name: 'agify', url: 'https://agify.io', expectedPathHint: '/' },
  { name: 'genderize', url: 'https://genderize.io', expectedPathHint: '/' },
  { name: 'nationalize', url: 'https://nationalize.io', expectedPathHint: '/' },
  { name: 'publicholiday', url: 'https://date.nager.at', expectedPathHint: '/api/v3' },
  { name: 'hackernews', url: 'https://news.ycombinator.com', expectedPathHint: '/item' },
  { name: 'coingecko', url: 'https://www.coingecko.com', expectedPathHint: '/api' },
  { name: 'wikipedia', url: 'https://en.wikipedia.org', expectedPathHint: '/api' },
  { name: 'npm', url: 'https://www.npmjs.com', expectedPathHint: '/search' },
  { name: 'stackoverflow', url: 'https://stackoverflow.com', expectedPathHint: '/api' },
  { name: 'open-meteo', url: 'https://open-meteo.com', expectedPathHint: '/v1' },
  { name: 'cocktaildb', url: 'https://www.thecocktaildb.com', expectedPathHint: '/api/json' },
  { name: 'openlib', url: 'https://openlibrary.org', expectedPathHint: '/search' },
  { name: 'duckduckgo', url: 'https://duckduckgo.com', expectedPathHint: '/' },
  { name: 'exchangerate', url: 'https://open.er-api.com', expectedPathHint: '/v6' },
  { name: 'boredapi', url: 'https://bored-api.appbrewery.com', expectedPathHint: '/api' },
]
