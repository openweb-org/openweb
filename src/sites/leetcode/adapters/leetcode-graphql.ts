import type { Page } from 'patchright'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * LeetCode L3 adapter — GraphQL API via browser fetch.
 *
 * LeetCode serves all data through a GraphQL endpoint at /graphql/.
 * No auth required for public data (problems, profiles, contests).
 * Submissions require login (cookie_session).
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const GRAPHQL_URL = 'https://leetcode.com/graphql/'

/* ---------- GraphQL queries ---------- */

const PROBLEM_LIST_QUERY = `query problemsetQuestionListV2($filters: QuestionFilterInput, $limit: Int, $searchKeyword: String, $skip: Int, $sortBy: QuestionSortByInput, $categorySlug: String) {
  problemsetQuestionListV2(filters: $filters, limit: $limit, searchKeyword: $searchKeyword, skip: $skip, sortBy: $sortBy, categorySlug: $categorySlug) {
    questions {
      id titleSlug title questionFrontendId paidOnly difficulty
      topicTags { name slug }
      status acRate frequency
    }
    totalLength finishedLength hasMore
  }
}`

const PROBLEM_SEARCH_QUERY = `query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data {
      titleSlug title questionFrontendId paidOnly: isPaidOnly difficulty
      topicTags { name slug }
      acRate
    }
  }
}`

const DAILY_CHALLENGE_QUERY = `query questionOfTodayV2 {
  activeDailyCodingChallengeQuestion {
    date link
    question {
      id: questionId titleSlug title questionFrontendId
      paidOnly: isPaidOnly difficulty
      topicTags { name slug }
      acRate
    }
  }
}`

const USER_PROFILE_QUERY = `query userPublicProfile($username: String!) {
  matchedUser(username: $username) {
    contestBadge { name expired hoverText icon }
    username githubUrl twitterUrl linkedinUrl
    profile {
      ranking userAvatar realName aboutMe school websites
      countryName company jobTitle skillTags
      reputation
    }
  }
}`

const USER_CONTEST_RANKING_QUERY = `query userContestRankingInfo($username: String!) {
  userContestRanking(username: $username) {
    attendedContestsCount rating globalRanking totalParticipants topPercentage
    badge { name }
  }
  userContestRankingHistory(username: $username) {
    attended trendDirection problemsSolved totalProblems
    finishTimeInSeconds rating ranking
    contest { title startTime }
  }
}`

const SUBMISSION_LIST_QUERY = `query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!, $lang: Int, $status: Int) {
  questionSubmissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug, lang: $lang, status: $status) {
    lastKey hasNext
    submissions {
      id title titleSlug status statusDisplay lang langName
      runtime timestamp url memory
    }
  }
}`

const SOLUTION_ARTICLES_QUERY = `query ugcArticleSolutionArticles($questionSlug: String!, $orderBy: ArticleOrderByEnum, $userInput: String, $tagSlugs: [String!], $skip: Int, $first: Int) {
  ugcArticleSolutionArticles(questionSlug: $questionSlug, orderBy: $orderBy, userInput: $userInput, tagSlugs: $tagSlugs, skip: $skip, first: $first) {
    totalNum
    edges {
      node {
        uuid title slug summary
        author { realName userAvatar userSlug }
        createdAt hitCount hasVideoArticle
        reactions { count reactionType }
        topic { id topLevelCommentCount }
        tags { name slug }
      }
    }
  }
}`

const UPCOMING_CONTESTS_QUERY = `query contestV2UpcomingContests {
  contestV2UpcomingContests {
    titleSlug title startTime duration cardImg
  }
}`

const HISTORY_CONTESTS_QUERY = `query contestV2HistoryContests($skip: Int!, $limit: Int!) {
  contestV2HistoryContests(skip: $skip, limit: $limit) {
    totalNum
    contests {
      titleSlug title startTime duration solved totalQuestions
    }
  }
}`

const CONTEST_QUESTIONS_QUERY = `query contestQuestionList($contestSlug: String!) {
  contestQuestionList(contestSlug: $contestSlug) {
    credit title titleSlug questionId
  }
}`

const RECENT_AC_SUBMISSIONS_QUERY = `query recentAcSubmissions($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) {
    id title titleSlug timestamp
  }
}`

const TOP_RANKINGS_QUERY = `query contestV2TopGlobalRankings {
  contestV2TopGlobalRankings {
    userProfile { realName userSlug avatarUrl countryCode }
    currentRating currentGlobalRanking attendedContestCount
  }
}`

/* ---------- adapter implementation ---------- */

async function graphqlFetch(
  page: Page,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify({ operationName, variables, query })

  // LeetCode requires x-csrftoken header for certain queries
  const cookies = await page.context().cookies('https://leetcode.com')
  const csrfToken = cookies.find((c) => c.name === 'csrftoken')?.value ?? ''

  const result = await page.evaluate(
    async (args: { url: string; body: string; csrf: string }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Referer: 'https://leetcode.com/problemset/',
      }
      if (args.csrf) headers['x-csrftoken'] = args.csrf
      const resp = await fetch(args.url, {
        method: 'POST',
        headers,
        body: args.body,
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url: GRAPHQL_URL, body, csrf: csrfToken },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GraphQL error'
    throw OpenWebError.apiError(`GraphQL ${operationName}`, msg)
  }

  return json.data
}

/* ---------- operation handlers ---------- */

function defaultFilters(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filterCombineType: 'ALL',
    statusFilter: { questionStatuses: [], operator: 'IS' },
    difficultyFilter: { difficulties: [], operator: 'IS' },
    languageFilter: { languageSlugs: [], operator: 'IS' },
    topicFilter: { topicSlugs: [], operator: 'IS' },
    acceptanceFilter: {},
    frequencyFilter: {},
    frontendIdFilter: {},
    lastSubmittedFilter: {},
    publishedFilter: {},
    companyFilter: { companySlugs: [], operator: 'IS' },
    positionFilter: { positionSlugs: [], operator: 'IS' },
    positionLevelFilter: { positionLevelSlugs: [], operator: 'IS' },
    contestPointFilter: { contestPoints: [], operator: 'IS' },
    premiumFilter: { premiumStatus: [], operator: 'IS' },
    ...overrides,
  }
}

async function searchProblems(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const keyword = String(params.keyword ?? params.search ?? '')
  const skip = Number(params.skip ?? 0)
  const limit = Number(params.limit ?? 50)

  // Use v1 questionList API — v2 requires login for keyword search
  const data = (await graphqlFetch(page, 'problemsetQuestionList', PROBLEM_SEARCH_QUERY, {
    categorySlug: 'all-code-essentials',
    skip,
    limit,
    filters: { searchKeywords: keyword },
  })) as Record<string, unknown>

  const result = data.problemsetQuestionList as Record<string, unknown>
  return {
    questions: result?.questions,
    totalLength: result?.total,
    hasMore: skip + limit < Number(result?.total ?? 0),
  }
}

async function getProblemList(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const skip = Number(params.skip ?? 0)
  const limit = Number(params.limit ?? 50)
  const difficulty = params.difficulty ? String(params.difficulty).toUpperCase() : undefined
  const topicSlug = params.topicSlug ? String(params.topicSlug) : undefined

  const overrides: Record<string, unknown> = {}
  if (difficulty) {
    overrides.difficultyFilter = { difficulties: [difficulty], operator: 'IS' }
  }
  if (topicSlug) {
    overrides.topicFilter = { topicSlugs: [topicSlug], operator: 'IS' }
  }
  const filters = defaultFilters(overrides)

  const data = (await graphqlFetch(page, 'problemsetQuestionListV2', PROBLEM_LIST_QUERY, {
    skip,
    limit,
    searchKeyword: '',
    categorySlug: 'all-code-essentials',
    filters,
    sortBy: { sortField: 'CUSTOM', sortOrder: 'ASCENDING' },
    filtersV2: filters,
  })) as Record<string, unknown>

  return data.problemsetQuestionListV2
}

async function getDailyChallenge(page: Page): Promise<unknown> {
  const data = (await graphqlFetch(page, 'questionOfTodayV2', DAILY_CHALLENGE_QUERY, {})) as Record<string, unknown>
  return data.activeDailyCodingChallengeQuestion
}

async function getUserProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const username = String(params.username)
  const data = (await graphqlFetch(page, 'userPublicProfile', USER_PROFILE_QUERY, { username })) as Record<
    string,
    unknown
  >
  return data.matchedUser
}

async function getUserContestRanking(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const username = String(params.username)
  const data = (await graphqlFetch(page, 'userContestRankingInfo', USER_CONTEST_RANKING_QUERY, {
    username,
  })) as Record<string, unknown>
  return data
}

async function getSubmissions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const questionSlug = String(params.questionSlug ?? params.slug)
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 20)

  const data = (await graphqlFetch(page, 'submissionList', SUBMISSION_LIST_QUERY, {
    questionSlug,
    offset,
    limit,
    lastKey: null,
  })) as Record<string, unknown>

  return data.questionSubmissionList
}

async function getSolutionArticles(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const questionSlug = String(params.questionSlug ?? params.slug)
  const skip = Number(params.skip ?? 0)
  const first = Number(params.first ?? 15)
  const orderBy = String(params.orderBy ?? 'HOT')

  const data = (await graphqlFetch(page, 'ugcArticleSolutionArticles', SOLUTION_ARTICLES_QUERY, {
    questionSlug,
    skip,
    first,
    orderBy,
    userInput: '',
    tagSlugs: [],
  })) as Record<string, unknown>

  const result = data.ugcArticleSolutionArticles as Record<string, unknown>
  const edges = (result?.edges ?? []) as Array<Record<string, unknown>>
  return {
    totalNum: result?.totalNum,
    articles: edges.map((e) => e.node),
  }
}

async function getUpcomingContests(page: Page): Promise<unknown> {
  const data = (await graphqlFetch(page, 'contestV2UpcomingContests', UPCOMING_CONTESTS_QUERY, {})) as Record<
    string,
    unknown
  >
  return { contests: data.contestV2UpcomingContests }
}

async function getContestHistory(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const skip = Number(params.skip ?? 0)
  const limit = Number(params.limit ?? 10)
  const data = (await graphqlFetch(page, 'contestV2HistoryContests', HISTORY_CONTESTS_QUERY, {
    skip,
    limit,
  })) as Record<string, unknown>
  return data.contestV2HistoryContests
}

async function getContestQuestions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const contestSlug = String(params.contestSlug ?? params.slug)
  const data = (await graphqlFetch(page, 'contestQuestionList', CONTEST_QUESTIONS_QUERY, {
    contestSlug,
  })) as Record<string, unknown>
  return { questions: data.contestQuestionList }
}

async function getRecentSubmissions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const username = String(params.username)
  const limit = Number(params.limit ?? 15)
  const data = (await graphqlFetch(page, 'recentAcSubmissions', RECENT_AC_SUBMISSIONS_QUERY, {
    username,
    limit,
  })) as Record<string, unknown>
  return { submissions: data.recentAcSubmissionList }
}

/* ---------- contest ranking (REST) ---------- */

async function getContestRanking(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const contestSlug = String(params.contestSlug ?? params.slug)
  const pageNum = Number(params.page ?? 1)
  const url = `https://leetcode.com/contest/api/ranking/${contestSlug}/?pagination=${pageNum}&region=global_v2`

  const result = await page.evaluate(async (fetchUrl: string) => {
    const resp = await fetch(fetchUrl, { credentials: 'include' })
    return { status: resp.status, text: await resp.text() }
  }, url)

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as Record<string, unknown>
  const totalRank = (json.total_rank ?? []) as Array<Record<string, unknown>>

  return {
    userCount: json.user_num,
    rankings: totalRank.map((r) => ({
      username: r.username,
      userSlug: r.user_slug,
      rank: r.rank,
      score: r.score,
      finishTime: r.finish_time,
      avatarUrl: r.avatar_url,
    })),
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProblems,
  getProblemList,
  getDailyChallenge,
  getUserProfile,
  getUserContestRanking,
  getSubmissions,
  getSolutionArticles,
  getUpcomingContests,
  getContestHistory,
  getContestQuestions,
  getRecentSubmissions,
  getContestRanking,
}

const adapter: CodeAdapter = {
  name: 'leetcode-graphql',
  description: 'LeetCode GraphQL API — problems, contests, profiles, solutions',

  async init(page: Page): Promise<boolean> {
    if (!page.url().includes('leetcode.com')) return false
    // Navigate to problemset page to ensure csrftoken cookie is set
    const cookies = await page.context().cookies('https://leetcode.com')
    if (!cookies.some((c) => c.name === 'csrftoken')) {
      await page.goto('https://leetcode.com/problemset/', { waitUntil: 'domcontentloaded', timeout: 15_000 })
    }
    return true
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://leetcode.com')
    return cookies.some((c) => c.name === 'LEETCODE_SESSION' || c.name === 'csrftoken')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw OpenWebError.unknownOp(operation)
      }
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
