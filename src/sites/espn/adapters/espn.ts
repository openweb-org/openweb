import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

const SITE_API = 'https://site.api.espn.com'
const WEB_API = 'https://site.web.api.espn.com'

async function fetchJson(url: string, errors: Errors): Promise<R> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '')
      parts.push(`${k}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

function firstLogo(logos: unknown): string | null {
  if (!Array.isArray(logos) || logos.length === 0) return null
  return (logos[0] as R).href as string ?? null
}

function trimTeamCompact(team: R): R {
  return {
    id: team.id,
    displayName: team.displayName,
    abbreviation: team.abbreviation,
    location: team.location,
    name: team.name,
    logo: firstLogo(team.logos) ?? team.logo ?? null,
  }
}

function trimStat(s: R): R {
  return { name: s.name, value: s.value, displayValue: s.displayValue }
}

// ── Operations ─────────────────────────────────────────

async function getScoreboard(params: Params, errors: Errors): Promise<unknown> {
  const sport = params.sport as string
  const league = params.league as string
  const url = `${SITE_API}/apis/site/v2/sports/${sport}/${league}/scoreboard${qs({ dates: params.dates })}`
  const raw = await fetchJson(url, errors)

  const leagues = (raw.leagues as R[] ?? []).map(lg => ({
    id: lg.id,
    name: lg.name,
    abbreviation: lg.abbreviation,
    season: lg.season ? { year: (lg.season as R).year, displayName: (lg.season as R).displayName } : null,
  }))

  const events = (raw.events as R[] ?? []).map(ev => {
    const competitions = (ev.competitions as R[] ?? []).map(comp => ({
      id: comp.id,
      date: comp.date,
      venue: comp.venue ? { id: (comp.venue as R).id, fullName: (comp.venue as R).fullName } : null,
      competitors: (comp.competitors as R[] ?? []).map(c => ({
        id: c.id,
        homeAway: c.homeAway,
        winner: c.winner,
        team: {
          id: (c.team as R).id,
          displayName: (c.team as R).displayName,
          abbreviation: (c.team as R).abbreviation,
          logo: (c.team as R).logo,
        },
        score: c.score,
        records: (c.records as R[] ?? []).map(r => ({ type: r.type, summary: r.summary })),
      })),
      status: comp.status ? {
        displayClock: (comp.status as R).displayClock,
        period: (comp.status as R).period,
        type: (comp.status as R).type ? {
          completed: ((comp.status as R).type as R).completed,
          description: ((comp.status as R).type as R).description,
          detail: ((comp.status as R).type as R).detail,
          state: ((comp.status as R).type as R).state,
        } : null,
      } : null,
      broadcasts: (comp.broadcasts as R[] ?? []).slice(0, 2).map(b => ({
        market: b.market, names: b.names,
      })),
    }))
    return {
      id: ev.id, date: ev.date, name: ev.name, shortName: ev.shortName,
      competitions,
      status: ev.status ? {
        displayClock: (ev.status as R).displayClock,
        period: (ev.status as R).period,
        type: (ev.status as R).type ? {
          completed: ((ev.status as R).type as R).completed,
          detail: ((ev.status as R).type as R).detail,
          state: ((ev.status as R).type as R).state,
        } : null,
      } : null,
    }
  })

  return { leagues, season: raw.season, day: raw.day, events }
}

async function getTeam(params: Params, errors: Errors): Promise<unknown> {
  const sport = params.sport as string
  const league = params.league as string
  const teamId = params.teamId as string
  const url = `${SITE_API}/apis/site/v2/sports/${sport}/${league}/teams/${teamId}`
  const raw = await fetchJson(url, errors)
  const team = raw.team as R
  if (!team) return raw

  const record = team.record as R | undefined
  const recordItems = record?.items as R[] | undefined

  return {
    team: {
      id: team.id,
      displayName: team.displayName,
      abbreviation: team.abbreviation,
      location: team.location,
      name: team.name,
      color: team.color,
      logo: firstLogo(team.logos),
      isActive: team.isActive,
      standingSummary: team.standingSummary ?? null,
      record: recordItems
        ? { items: recordItems.map(r => ({ type: r.type, summary: r.summary })) }
        : null,
      nextEvent: (team.nextEvent as R[] ?? []).slice(0, 1).map(ev => ({
        id: ev.id, date: ev.date, name: ev.name, shortName: ev.shortName,
      })),
    },
  }
}

async function getTeams(params: Params, errors: Errors): Promise<unknown> {
  const sport = params.sport as string
  const league = params.league as string
  const url = `${SITE_API}/apis/site/v2/sports/${sport}/${league}/teams`
  const raw = await fetchJson(url, errors)

  const sports = (raw.sports as R[] ?? []).map(s => ({
    id: s.id,
    name: s.name,
    leagues: (s.leagues as R[] ?? []).map(lg => ({
      id: lg.id,
      name: lg.name,
      abbreviation: lg.abbreviation,
      teams: (lg.teams as R[] ?? []).map(t => ({
        team: trimTeamCompact(t.team as R),
      })),
    })),
  }))

  return { sports }
}

async function getStandings(params: Params, errors: Errors): Promise<unknown> {
  const sport = params.sport as string
  const league = params.league as string
  const url = `${SITE_API}/apis/v2/sports/${sport}/${league}/standings`
  const raw = await fetchJson(url, errors)

  const children = (raw.children as R[] ?? []).map(group => ({
    id: group.id,
    name: group.name,
    abbreviation: group.abbreviation,
    standings: group.standings ? {
      season: (group.standings as R).season,
      seasonDisplayName: (group.standings as R).seasonDisplayName,
      entries: ((group.standings as R).entries as R[] ?? []).map(entry => ({
        team: {
          id: (entry.team as R).id,
          displayName: (entry.team as R).displayName,
          abbreviation: (entry.team as R).abbreviation,
          logo: firstLogo((entry.team as R).logos),
        },
        stats: (entry.stats as R[] ?? []).map(trimStat),
      })),
    } : null,
  }))

  return {
    id: raw.id, name: raw.name, abbreviation: raw.abbreviation,
    children,
  }
}

async function getNews(params: Params, errors: Errors): Promise<unknown> {
  const sport = params.sport as string
  const league = params.league as string
  const url = `${SITE_API}/apis/site/v2/sports/${sport}/${league}/news`
  const raw = await fetchJson(url, errors)

  const articles = (raw.articles as R[] ?? []).map(a => {
    const images = a.images as R[] ?? []
    const links = a.links as R | undefined
    const webHref = links?.web ? ((links.web as R).href as string) : null
    const categories = (a.categories as R[] ?? [])
      .filter(c => c.type === 'league' || c.type === 'team' || c.type === 'athlete')
      .map(c => ({ type: c.type, description: c.description }))

    return {
      id: a.id,
      headline: a.headline,
      description: a.description,
      published: a.published,
      type: a.type,
      ...(a.byline ? { byline: a.byline } : {}),
      premium: a.premium ?? false,
      image: images.length > 0 ? { url: images[0].url, caption: images[0].caption } : null,
      link: webHref,
      categories: categories.length > 0 ? categories : undefined,
    }
  })

  return { header: raw.header, articles }
}

async function searchPlayers(params: Params, errors: Errors): Promise<unknown> {
  const url = `${WEB_API}/apis/common/v3/search${qs({
    query: params.query,
    limit: params.limit,
    type: params.type ?? 'player',
  })}`
  const raw = await fetchJson(url, errors)

  const items = (raw.items as R[] ?? []).map(item => {
    const teamRels = item.teamRelationships as R[] | undefined
    const teamName = teamRels?.[0] ? (teamRels[0] as R).displayName as string : null

    return {
      id: item.id,
      displayName: item.displayName,
      shortName: item.shortName,
      type: item.type,
      sport: item.sport,
      league: item.league,
      label: item.label,
      jersey: item.jersey ?? null,
      team: teamName,
      isActive: item.isActive,
      headshot: item.headshot ? (item.headshot as R).href : null,
    }
  })

  return { count: raw.count, items }
}

// ── Adapter ────────────────────────────────────────────

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  getScoreboard,
  getTeam,
  getTeams,
  getStandings,
  getNews,
  searchPlayers,
}

const adapter: CustomRunner = {
  name: 'espn',
  description: 'ESPN — response trimming for all 6 read ops',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
