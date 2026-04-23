import type { CDPSession, Page } from 'patchright'

import type { CustomRunner, AdapterHelpers } from '../../../types/adapter.js'

const VENTURE_ORIGIN = 'https://venture.angellist.com'
const PORTAL_ORIGIN = 'https://portal.angellist.com'

const Q_VIEWER = `query ViewerQuery {
  currentUser { id slug investAccounts { id slugName } }
}`

const Q_CURRENT_INVITES = `query CurrentDealInvitesQuery($userId: ID!, $investAccountId: ID) {
  invest {
    currentDealInvites(userId: $userId, investAccountId: $investAccountId) {
      id invitedAt lastViewedAt passReason passedExplicitly
      opportunity {
        id virtualDealId hasStopped canInvest closeDate
        investableName investableAvatar investableSlug
        investUrl closeUrl
        syndicate { id name slug }
      }
    }
  }
}`

const Q_CONVERSATIONS = `query ConversationsQuery($userSlug: String!, $searchQuery: String, $cursor: String, $limit: Int!) {
  venture {
    conversations(userSlug: $userSlug, searchQuery: $searchQuery, first: $limit, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id isUnread
          entities { name isSelf ... on VentureConversationEntityUser { userId } }
          lastMessage { id text sentAt sentBy { name isSelf } }
        }
      }
    }
  }
}`

const Q_CONVERSATION = `query ConversationQuery($userSlug: String!, $conversationId: ID, $searchQuery: String, $cursor: String, $limit: Int!) {
  venture {
    conversation(userSlug: $userSlug, conversationId: $conversationId, searchQuery: $searchQuery) {
      id
      entities { name isSelf ... on VentureConversationEntityUser { userId } }
      messages(
        userSlug: $userSlug
        conversationId: $conversationId
        searchQuery: $searchQuery
        first: $limit
        after: $cursor
      ) {
        pageInfo { hasNextPage endCursor }
        edges {
          node { id text sentAt sentBy { name isSelf } }
        }
      }
    }
  }
}`

const Q_POSTS = `query InvestPostsQuery($searchQuery: String, $cursor: String, $limit: Int!) {
  invest {
    posts(searchQuery: $searchQuery, first: $limit, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node { id title fromName publishAt avatarUrl hasAttachments isUnread }
      }
    }
  }
}`

const Q_POST = `query InvestPostQuery($postId: ID!) {
  invest {
    post(postId: $postId) {
      id title fromName body publishAt avatarUrl isUnread
      documents { id }
      syndicate { name }
    }
  }
}`

const Q_DATAROOM = `query MemberDataRoom($senderOrgHandle: String!, $dataRoomHandle: String!, $previewAs: String) {
  listDataRoomSections(senderOrgHandle: $senderOrgHandle, dataRoomHandle: $dataRoomHandle, previewAs: $previewAs) {
    id type internalKey orderKey
    config { header layout }
    pmstate
    dataRoomSectionFiles {
      id
      dataRoomFile {
        file { id originalFilename mimeType extension thumbnail }
      }
    }
  }
}`

interface ViewerInfo {
  userId: string
  investAccountId: string
  userSlug: string
}

let cachedViewer: ViewerInfo | null = null
let cdpSession: CDPSession | null = null

async function getCdp(page: Page): Promise<CDPSession> {
  if (cdpSession) return cdpSession
  cdpSession = await page.context().newCDPSession(page)
  return cdpSession
}

async function mainWorldEval(page: Page, expression: string): Promise<any> {
  const cdp = await getCdp(page)
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed'
    throw new Error(msg)
  }
  return result.result.value
}

async function ensureVenturePage(page: Page): Promise<void> {
  const url = page.url()
  if (!url.startsWith(VENTURE_ORIGIN) || url.includes('/login')) {
    await page.goto(`${VENTURE_ORIGIN}/v/`, { waitUntil: 'networkidle', timeout: 25_000 })
  }
  await page.waitForFunction(() => !!(window as any).__APOLLO_CLIENT__, { timeout: 15_000 })
}

async function ventureGql(
  page: Page,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  await ensureVenturePage(page)
  const script = `(async () => {
    if (!window.__gqlParse) {
      const { parse } = await import('https://esm.sh/graphql@16.8.1/language/parser');
      window.__gqlParse = parse;
    }
    const doc = window.__gqlParse(${JSON.stringify(query)});
    const result = await window.__APOLLO_CLIENT__.query({
      query: doc,
      variables: ${JSON.stringify(variables)},
      fetchPolicy: 'no-cache',
    });
    return JSON.stringify(result.data);
  })()`
  const raw = await mainWorldEval(page, script)
  return JSON.parse(raw)
}

async function resolveViewer(page: Page): Promise<ViewerInfo> {
  if (cachedViewer) return cachedViewer
  const data = await ventureGql(page, Q_VIEWER, {})
  const user = data?.currentUser
  if (!user?.id) throw new Error('Not logged in — run: openweb login angellist')
  cachedViewer = {
    userId: user.id,
    investAccountId: user.investAccounts?.[0]?.id ?? '',
    userSlug: user.slug,
  }
  return cachedViewer
}

function clean(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(clean)
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === '__typename') continue
      out[k] = clean(v)
    }
    return out
  }
  return obj
}

async function listInvites(page: Page, _params: Record<string, unknown>, _h: AdapterHelpers) {
  const v = await resolveViewer(page)
  const data = await ventureGql(page, Q_CURRENT_INVITES, {
    userId: v.userId,
    investAccountId: v.investAccountId,
  })
  return clean((data?.invest?.currentDealInvites ?? []).map((inv: any) => ({
    id: inv.id,
    invitedAt: inv.invitedAt,
    lastViewedAt: inv.lastViewedAt,
    passedExplicitly: inv.passedExplicitly,
    dealName: inv.opportunity?.investableName,
    dealSlug: inv.opportunity?.investableSlug,
    virtualDealId: inv.opportunity?.virtualDealId,
    canInvest: inv.opportunity?.canInvest,
    hasStopped: inv.opportunity?.hasStopped,
    closeDate: inv.opportunity?.closeDate,
    syndicateName: inv.opportunity?.syndicate?.name,
    syndicateSlug: inv.opportunity?.syndicate?.slug,
    investUrl: inv.opportunity?.investUrl,
    avatarUrl: inv.opportunity?.investableAvatar,
  })))
}

async function getInvite(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const virtualDealId = String(params.virtualDealId || '')
  if (!virtualDealId) throw helpers.errors.missingParam('virtualDealId')

  // Portal page fires MemberDataRoom GQL on load — intercept the response
  let dataRoomData: any = null
  const handler = async (resp: any) => {
    try {
      const url = resp.url()
      if (url.includes('/api/graphql') && !dataRoomData) {
        const text = await resp.text()
        const json = JSON.parse(text)
        if (json?.data?.listDataRoomSections) {
          dataRoomData = json.data
        }
      }
    } catch { /* response body unavailable */ }
  }
  page.on('response', handler)

  try {
    await page.goto(`${PORTAL_ORIGIN}/l/r/dr?fundraisingCampaignId=${virtualDealId}`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })
  } finally {
    page.off('response', handler)
  }

  const finalUrl = page.url()
  const urlMatch = finalUrl.match(/\/r\/s\/([^/]+)\/datarooms\/([^/?]+)/)

  if (!dataRoomData) {
    throw helpers.errors.fatal(`MemberDataRoom response not captured from ${finalUrl}`)
  }

  const sections = dataRoomData.listDataRoomSections ?? []
  return clean({
    senderOrgHandle: urlMatch?.[1] ?? '',
    dataRoomHandle: urlMatch?.[2] ?? '',
    sections: sections.map((s: any) => ({
      id: s.id,
      type: s.type,
      header: s.config?.header,
      internalKey: s.internalKey,
      content: s.pmstate,
      files: (s.dataRoomSectionFiles ?? []).map((f: any) => ({
        id: f.id,
        filename: f.dataRoomFile?.file?.originalFilename,
        mimeType: f.dataRoomFile?.file?.mimeType,
        extension: f.dataRoomFile?.file?.extension,
        thumbnail: f.dataRoomFile?.file?.thumbnail,
      })),
    })),
  })
}

async function listMessages(page: Page, params: Record<string, unknown>, _h: AdapterHelpers) {
  const v = await resolveViewer(page)
  const data = await ventureGql(page, Q_CONVERSATIONS, {
    userSlug: v.userSlug,
    searchQuery: params.searchQuery ? String(params.searchQuery) : '',
    limit: Number(params.limit) || 20,
    ...(params.cursor ? { cursor: String(params.cursor) } : {}),
  })
  const convo = data?.venture?.conversations
  return clean({
    hasNextPage: convo?.pageInfo?.hasNextPage,
    endCursor: convo?.pageInfo?.endCursor,
    conversations: (convo?.edges ?? []).map((e: any) => {
      const n = e.node
      return {
        id: n.id,
        participants: (n.entities ?? []).filter((p: any) => !p.isSelf).map((p: any) => ({
          name: p.name, userId: p.userId,
        })),
        lastMessage: n.lastMessage ? {
          id: n.lastMessage.id,
          text: n.lastMessage.text,
          sentAt: n.lastMessage.sentAt,
          sentBy: n.lastMessage.sentBy?.name,
        } : null,
        isUnread: n.isUnread,
      }
    }),
  })
}

async function getMessage(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const v = await resolveViewer(page)
  const conversationId = String(params.conversationId || '')
  if (!conversationId) throw helpers.errors.missingParam('conversationId')
  const data = await ventureGql(page, Q_CONVERSATION, {
    userSlug: v.userSlug,
    conversationId,
    searchQuery: '',
    limit: Number(params.limit) || 25,
  })
  const c = data?.venture?.conversation
  return clean({
    id: c?.id,
    participants: (c?.entities ?? []).map((p: any) => ({
      name: p.name, userId: p.userId, isSelf: p.isSelf,
    })),
    hasNextPage: c?.messages?.pageInfo?.hasNextPage,
    endCursor: c?.messages?.pageInfo?.endCursor,
    messages: (c?.messages?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      text: e.node.text,
      sentAt: e.node.sentAt,
      sentBy: e.node.sentBy?.name,
      isSelf: e.node.sentBy?.isSelf,
    })),
  })
}

async function listPosts(page: Page, params: Record<string, unknown>, _h: AdapterHelpers) {
  const data = await ventureGql(page, Q_POSTS, {
    searchQuery: params.searchQuery ? String(params.searchQuery) : '',
    limit: Number(params.limit) || 20,
    ...(params.cursor ? { cursor: String(params.cursor) } : {}),
  })
  const posts = data?.invest?.posts
  return clean({
    hasNextPage: posts?.pageInfo?.hasNextPage,
    endCursor: posts?.pageInfo?.endCursor,
    posts: (posts?.edges ?? []).map((e: any) => ({
      id: e.node.id,
      title: e.node.title,
      fromName: e.node.fromName,
      publishAt: e.node.publishAt,
      avatarUrl: e.node.avatarUrl,
      hasAttachments: e.node.hasAttachments,
      isUnread: e.node.isUnread,
    })),
  })
}

async function getPost(page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) {
  const postId = String(params.postId || '')
  if (!postId) throw helpers.errors.missingParam('postId')
  const data = await ventureGql(page, Q_POST, { postId })
  const p = data?.invest?.post
  return clean({
    id: p?.id,
    title: p?.title,
    fromName: p?.fromName,
    body: p?.body,
    publishAt: p?.publishAt,
    avatarUrl: p?.avatarUrl,
    syndicateName: p?.syndicate?.name,
    documents: p?.documents ?? [],
    isUnread: p?.isUnread,
  })
}

type OpHandler = (page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  listInvites, getInvite, listMessages, getMessage, listPosts, getPost,
}

const adapter: CustomRunner = {
  name: 'angellist',
  description: 'AngelList Venture — GraphQL via Apollo client (main-world CDP)',
  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw (helpers as AdapterHelpers).errors.unknownOp(operation)
    cdpSession = null
    return handler(page as Page, { ...params }, helpers as AdapterHelpers)
  },
}

export default adapter
