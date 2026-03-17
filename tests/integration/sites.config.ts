/**
 * Per-site integration test configuration.
 * These configs describe real-world smoke tests against live sites.
 * Auth drift (401/403) results in SKIP, not FAIL.
 */
export interface SiteIntegrationTest {
  readonly site: string
  readonly page_url: string
  readonly requires_login: boolean
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
    smoke: { operation: 'lookupIp', params: { ip: '8.8.8.8' } },
  },
]
