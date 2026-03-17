/**
 * Per-site integration test configuration.
 * These configs describe real-world smoke tests against live sites.
 * Auth drift (401/403) results in SKIP, not FAIL.
 */
export interface SiteIntegrationTest {
  readonly site: string
  readonly page_url: string
  readonly requires_login: boolean
  /** Mark as flaky if the site rate-limits or returns intermittent errors. */
  readonly flaky?: boolean
  readonly smoke: {
    readonly operation: string
    readonly params: Record<string, unknown>
  }
  readonly pagination?: {
    readonly operation: string
    readonly params: Record<string, unknown>
  }
}

export const sites: SiteIntegrationTest[] = [
  {
    site: 'open-meteo-fixture',
    page_url: 'https://open-meteo.com',
    requires_login: false,
    smoke: { operation: 'search_location', params: { name: 'Berlin', count: 1 } },
  },
  {
    site: 'instagram-fixture',
    page_url: 'https://www.instagram.com',
    requires_login: true,
    smoke: { operation: 'getTimeline', params: {} },
    pagination: { operation: 'getTimeline', params: {} },
  },
  {
    site: 'github-fixture',
    page_url: 'https://github.com',
    requires_login: true,
    smoke: { operation: 'getRepo', params: { owner: 'anthropics', repo: 'claude-code' } },
  },
  {
    site: 'youtube-fixture',
    page_url: 'https://www.youtube.com',
    requires_login: true,
    smoke: { operation: 'getVideoInfo', params: { videoId: 'dQw4w9WgXcQ' } },
  },
  {
    site: 'reddit-fixture',
    page_url: 'https://www.reddit.com',
    requires_login: true,
    smoke: { operation: 'getMe', params: {} },
  },
  {
    site: 'bluesky-fixture',
    page_url: 'https://bsky.app',
    requires_login: true,
    smoke: { operation: 'getTimeline', params: {} },
  },
  {
    site: 'discord-fixture',
    page_url: 'https://discord.com',
    requires_login: true,
    smoke: { operation: 'getMe', params: {} },
  },
  {
    site: 'hackernews-fixture',
    page_url: 'https://news.ycombinator.com',
    requires_login: false,
    smoke: { operation: 'getTopStories', params: {} },
  },
  {
    site: 'walmart-fixture',
    page_url: 'https://www.walmart.com',
    requires_login: false,
    smoke: { operation: 'getFooterModules', params: {} },
  },
  {
    site: 'microsoft-word-fixture',
    page_url: 'https://www.office.com',
    requires_login: true,
    smoke: { operation: 'getProfile', params: {} },
  },
  {
    site: 'newrelic-fixture',
    page_url: 'https://one.newrelic.com',
    requires_login: true,
    smoke: { operation: 'listDashboards', params: {} },
  },
  {
    site: 'chatgpt-fixture',
    page_url: 'https://chatgpt.com',
    requires_login: true,
    smoke: { operation: 'getProfile', params: {} },
  },
  {
    site: 'x-fixture',
    page_url: 'https://x.com',
    requires_login: true,
    smoke: { operation: 'listFollowing', params: {} },
  },
  {
    site: 'whatsapp-fixture',
    page_url: 'https://web.whatsapp.com',
    requires_login: true,
    smoke: { operation: 'getChats', params: {} },
  },
  {
    site: 'telegram-fixture',
    page_url: 'https://web.telegram.org',
    requires_login: true,
    smoke: { operation: 'getDialogs', params: {} },
  },
  {
    site: 'stackoverflow-fixture',
    page_url: 'https://stackoverflow.com',
    requires_login: false,
    smoke: { operation: 'searchQuestions', params: { intitle: 'javascript async await' } },
  },
  {
    site: 'coingecko-fixture',
    page_url: 'https://www.coingecko.com',
    requires_login: false,
    smoke: { operation: 'getPrice', params: { ids: 'bitcoin', vs_currencies: 'usd' } },
  },
  {
    site: 'wikipedia-fixture',
    page_url: 'https://en.wikipedia.org',
    requires_login: false,
    smoke: { operation: 'searchArticles', params: { srsearch: 'Claude Shannon' } },
  },
  {
    site: 'npm-fixture',
    page_url: 'https://www.npmjs.com',
    requires_login: false,
    smoke: { operation: 'searchPackages', params: { text: 'express' } },
  },
  {
    site: 'duckduckgo-fixture',
    page_url: 'https://duckduckgo.com',
    requires_login: false,
    smoke: { operation: 'instantAnswer', params: { q: 'Claude Shannon' } },
  },
  {
    site: 'jsonplaceholder-fixture',
    page_url: 'https://jsonplaceholder.typicode.com',
    requires_login: false,
    smoke: { operation: 'listPosts', params: { _limit: 2 } },
  },
  {
    site: 'dogceo-fixture',
    page_url: 'https://dog.ceo',
    requires_login: false,
    smoke: { operation: 'getRandomImage', params: {} },
  },
  {
    site: 'github-public-fixture',
    page_url: 'https://github.com',
    requires_login: false,
    smoke: { operation: 'listRepoStargazers', params: { owner: 'anthropics', repo: 'claude-code', per_page: 2 } },
    pagination: { operation: 'listRepoStargazers', params: { owner: 'anthropics', repo: 'claude-code', per_page: 2 } },
  },
  {
    site: 'restcountries-fixture',
    page_url: 'https://restcountries.com',
    requires_login: false,
    smoke: { operation: 'searchByName', params: { name: 'Germany' } },
  },
  {
    site: 'ipapi-fixture',
    page_url: 'https://ipapi.co',
    requires_login: false,
    flaky: true, // Rate-limited: may return 429 under load
    smoke: { operation: 'lookupIp', params: { ip: '8.8.8.8' } },
  },
  // ── M11 new sites ──────────────────────────────────────────
  {
    site: 'agify-fixture',
    page_url: 'https://agify.io',
    requires_login: false,
    smoke: { operation: 'predictAge', params: { name: 'michael' } },
  },
  {
    site: 'boredapi-fixture',
    page_url: 'https://bored-api.appbrewery.com',
    requires_login: false,
    smoke: { operation: 'getRandomActivity', params: {} },
  },
  {
    site: 'catfact-fixture',
    page_url: 'https://catfact.ninja',
    requires_login: false,
    smoke: { operation: 'getFact', params: {} },
  },
  {
    site: 'exchangerate-fixture',
    page_url: 'https://open.er-api.com',
    requires_login: false,
    smoke: { operation: 'getLatestRates', params: { base: 'USD' } },
  },
  {
    site: 'genderize-fixture',
    page_url: 'https://genderize.io',
    requires_login: false,
    smoke: { operation: 'predictGender', params: { name: 'michael' } },
  },
  {
    site: 'httpbin-fixture',
    page_url: 'https://httpbin.org',
    requires_login: false,
    smoke: { operation: 'getIp', params: {} },
  },
  {
    site: 'nationalize-fixture',
    page_url: 'https://nationalize.io',
    requires_login: false,
    smoke: { operation: 'predictNationality', params: { name: 'michael' } },
  },
  {
    site: 'openlib-fixture',
    page_url: 'https://openlibrary.org',
    requires_login: false,
    smoke: { operation: 'searchBooks', params: { q: 'javascript' } },
  },
  {
    site: 'pokeapi-fixture',
    page_url: 'https://pokeapi.co',
    requires_login: false,
    smoke: { operation: 'getPokemon', params: { name: 'pikachu' } },
  },
  {
    site: 'randomuser-fixture',
    page_url: 'https://randomuser.me',
    requires_login: false,
    smoke: { operation: 'getRandomUser', params: { results: '1' } },
  },
  // ── M12 new sites ──────────────────────────────────────────
  {
    site: 'advice-fixture',
    page_url: 'https://api.adviceslip.com',
    requires_login: false,
    smoke: { operation: 'getRandomAdvice', params: {} },
  },
  {
    site: 'affirmations-fixture',
    page_url: 'https://www.affirmations.dev',
    requires_login: false,
    smoke: { operation: 'getAffirmation', params: {} },
  },
  {
    site: 'chucknorris-fixture',
    page_url: 'https://api.chucknorris.io',
    requires_login: false,
    smoke: { operation: 'getRandomJoke', params: {} },
  },
  {
    site: 'cocktaildb-fixture',
    page_url: 'https://www.thecocktaildb.com',
    requires_login: false,
    smoke: { operation: 'searchCocktails', params: { s: 'margarita' } },
  },
  {
    site: 'colorapi-fixture',
    page_url: 'https://www.thecolorapi.com',
    requires_login: false,
    smoke: { operation: 'getColor', params: { hex: '0047AB' } },
  },
  {
    site: 'countryis-fixture',
    page_url: 'https://api.country.is',
    requires_login: false,
    smoke: { operation: 'getCountry', params: { ip: '8.8.8.8' } },
  },
  {
    site: 'dictionaryapi-fixture',
    page_url: 'https://api.dictionaryapi.dev',
    requires_login: false,
    smoke: { operation: 'getDefinition', params: { word: 'hello' } },
  },
  {
    site: 'foxes-fixture',
    page_url: 'https://randomfox.ca',
    requires_login: false,
    smoke: { operation: 'getRandomFox', params: {} },
  },
  {
    site: 'kanye-fixture',
    page_url: 'https://api.kanye.rest',
    requires_login: false,
    flaky: true, // API may be intermittently down
    smoke: { operation: 'getQuote', params: {} },
  },
  {
    site: 'official-joke-fixture',
    page_url: 'https://official-joke-api.appspot.com',
    requires_login: false,
    smoke: { operation: 'getRandomJoke', params: {} },
  },
  {
    site: 'publicholiday-fixture',
    page_url: 'https://date.nager.at',
    requires_login: false,
    smoke: { operation: 'getPublicHolidays', params: { year: 2025, countryCode: 'US' } },
  },
  {
    site: 'sunrise-sunset-fixture',
    page_url: 'https://api.sunrise-sunset.org',
    requires_login: false,
    smoke: { operation: 'getSunriseSunset', params: { lat: 36.7201, lng: -4.4203 } },
  },
  {
    site: 'universities-fixture',
    page_url: 'http://universities.hipolabs.com',
    requires_login: false,
    smoke: { operation: 'searchUniversities', params: { name: 'MIT' } },
  },
  {
    site: 'uselessfacts-fixture',
    page_url: 'https://uselessfacts.jsph.pl',
    requires_login: false,
    smoke: { operation: 'getRandomFact', params: {} },
  },
  {
    site: 'worldtime-fixture',
    page_url: 'http://worldtimeapi.org',
    requires_login: false,
    smoke: { operation: 'getTimezone', params: { area: 'America', location: 'New_York' } },
  },
  {
    site: 'zippopotam-fixture',
    page_url: 'https://api.zippopotam.us',
    requires_login: false,
    smoke: { operation: 'getZipInfo', params: { zipcode: '90210' } },
  },
]
