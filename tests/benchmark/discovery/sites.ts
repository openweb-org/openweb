/**
 * Discovery benchmark site configurations.
 * 20 public API sites — no auth required.
 * Mix of: 5 existing fixtures (rediscovery) + 15 more public APIs.
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
  { name: 'open-meteo', url: 'https://open-meteo.com', expectedPathHint: '/v1/forecast' },
  { name: 'catfact', url: 'https://catfact.ninja', expectedPathHint: '/fact' },
  { name: 'pokeapi', url: 'https://pokeapi.co', expectedPathHint: '/api/v2/pokemon' },
  { name: 'randomuser', url: 'https://randomuser.me', expectedPathHint: '/api' },
  { name: 'httpbin', url: 'https://httpbin.org', expectedPathHint: '/get' },

  // ── Public API sites (fresh discovery) ──
  { name: 'jsonplaceholder', url: 'https://jsonplaceholder.typicode.com', expectedPathHint: '/posts' },
  { name: 'restcountries', url: 'https://restcountries.com', expectedPathHint: '/v3.1' },
  { name: 'exchangerate', url: 'https://open.er-api.com', expectedPathHint: '/v6/latest' },
  { name: 'agify', url: 'https://agify.io', expectedPathHint: '/' },
  { name: 'genderize', url: 'https://genderize.io', expectedPathHint: '/' },
  { name: 'nationalize', url: 'https://nationalize.io', expectedPathHint: '/' },
  { name: 'cocktaildb', url: 'https://www.thecocktaildb.com', expectedPathHint: '/api/json' },
  { name: 'colorapi', url: 'https://www.thecolorapi.com', expectedPathHint: '/id' },
  { name: 'dictionaryapi', url: 'https://api.dictionaryapi.dev', expectedPathHint: '/api/v2/entries' },
  { name: 'publicholiday', url: 'https://date.nager.at', expectedPathHint: '/api/v3' },
  { name: 'sunrise-sunset', url: 'https://api.sunrise-sunset.org', expectedPathHint: '/json' },
  { name: 'universities', url: 'http://universities.hipolabs.com', expectedPathHint: '/search' },
  { name: 'zippopotam', url: 'https://api.zippopotam.us', expectedPathHint: '/us' },
  { name: 'dogceo', url: 'https://dog.ceo', expectedPathHint: '/api' },
  { name: 'chucknorris', url: 'https://api.chucknorris.io', expectedPathHint: '/jokes' },
]
