/* ---------- GraphQL queries ---------- */

export const TOPIC_LATEST_STORIES_QUERY = `query TopicLatestStorieQuery($tagSlug: String!) {
  tagFromSlug(tagSlug: $tagSlug) {
    posts(timeRange: {kind: ALL_TIME}, sortOrder: NEWEST, first: 20) {
      edges {
        node {
          id
          title
          mediumUrl
          isLocked
          clapCount
          visibility
          creator {
            id
            name
            username
            imageId
            __typename
          }
          collection {
            id
            name
            slug
            domain
            __typename
          }
          previewImage { id alt __typename }
          extendedPreviewContent { subtitle isFullContent __typename }
          postResponses { count __typename }
          firstPublishedAt
          latestPublishedAt
          readingTime
          __typename
        }
        cursor
        __typename
      }
      pageInfo { hasNextPage endCursor __typename }
      __typename
    }
    id
    __typename
  }
}`

export const TOPIC_CURATED_LISTS_QUERY = `query TopicCuratedListQuery($tagSlug: String!) {
  tagFromSlug(tagSlug: $tagSlug) {
    curatedLists(first: 5) {
      edges {
        node {
          id
          name
          creator {
            id
            name
            username
            __typename
          }
          itemsConnection(pagingOptions: {limit: 10}) {
            items {
              entity {
                ... on Post {
                  id
                  title
                  mediumUrl
                  creator { id name username __typename }
                  readingTime
                  clapCount
                  __typename
                }
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    id
    __typename
  }
}`

export const TOPIC_WRITERS_QUERY = `query TopicWhoToFollowPubishersQuery($first: Int!, $after: String!, $mode: RecommendedPublishersMode!, $tagSlug: String) {
  recommendedPublishers(first: $first, after: $after, mode: $mode, tagSlug: $tagSlug) {
    edges {
      node {
        ... on User {
          id
          name
          bio
          username
          imageId
          socialStats { followerCount __typename }
          __typename
        }
        ... on Collection {
          id
          name
          description
          slug
          domain
          __typename
        }
        __typename
      }
      __typename
    }
    pageInfo { hasNextPage endCursor startCursor __typename }
    __typename
  }
}`

export const RECOMMENDED_FEED_QUERY = `query WebInlineRecommendedFeedQuery($forceRank: Boolean, $paging: PagingOptions) {
  webRecommendedFeed(forceRank: $forceRank, paging: $paging) {
    items {
      feedId
      reason
      post {
        id
        title
        mediumUrl
        isLocked
        clapCount
        visibility
        creator {
          id
          name
          username
          imageId
          __typename
        }
        collection {
          id
          name
          slug
          domain
          __typename
        }
        previewImage { id alt __typename }
        extendedPreviewContent { subtitle isFullContent __typename }
        postResponses { count __typename }
        firstPublishedAt
        latestPublishedAt
        readingTime
        __typename
      }
      __typename
    }
    pagingInfo { next { limit to __typename } __typename }
    __typename
  }
}`

export const RECOMMENDED_TAGS_QUERY = `query RightSidebarQuery {
  recommendedTags(input: {first: 7}) {
    edges {
      node {
        id
        displayTitle
        normalizedTagSlug
        __typename
      }
      __typename
    }
    __typename
  }
}`

export const POST_DETAIL_QUERY = `query PostDetailQuery($postId: ID!) {
  postResult(id: $postId) {
    ... on Post {
      id
      title
      mediumUrl
      visibility
      isLocked
      clapCount
      readingTime
      firstPublishedAt
      latestPublishedAt
      creator {
        id
        name
        username
        imageId
        __typename
      }
      collection {
        id
        name
        slug
        domain
        __typename
      }
      previewImage { id alt __typename }
      extendedPreviewContent { subtitle isFullContent __typename }
      postResponses { count __typename }
      __typename
    }
    __typename
  }
}`

export const POST_CLAPS_QUERY = `query ClapCountQuery($postId: ID!) {
  postResult(id: $postId) {
    ... on Post {
      id
      clapCount
      __typename
    }
    __typename
  }
}`

export const RECOMMENDED_WRITERS_QUERY = `query WhoToFollowModuleQuery {
  recommendedPublishers(first: 3, after: "", mode: ALL) {
    edges {
      node {
        ... on User {
          id
          name
          bio
          username
          imageId
          __typename
        }
        ... on Collection {
          id
          name
          description
          slug
          domain
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`

/* ---------- GraphQL mutations ---------- */

export const VIEWER_QUERY = `query ViewerQuery {
  viewer {
    id
    __typename
  }
}`

export const CLAP_MUTATION = `mutation ClapMutation($targetPostId: ID!, $userId: ID!, $numClaps: Int!) {
  clap(targetPostId: $targetPostId, userId: $userId, numClaps: $numClaps) {
    viewerEdge {
      __typename
      id
      clapCount
    }
    __typename
    id
    clapCount
  }
}`

export const FOLLOW_USER_MUTATION = `mutation FollowUserMutation($userId: ID!) {
  followUser(targetUserId: $userId) {
    id
    name
    username
    viewerEdge {
      id
      isFollowing
      __typename
    }
    __typename
  }
}`

export const SAVE_ARTICLE_MUTATION = `mutation AddToPredefinedCatalog($type: PredefinedCatalogType!, $operation: PredefinedCatalogAddOperationInput!) {
  addToPredefinedCatalog(type: $type, operation: $operation) {
    __typename
    ... on AddToPredefinedCatalogSucces {
      version
      insertedItem {
        __typename
        catalogItemId
        catalogId
        entity {
          __typename
          ... on Post {
            id
            __typename
          }
        }
      }
      __typename
    }
  }
}`

export const UNFOLLOW_USER_MUTATION = `mutation UnfollowUserMutation($userId: ID!) {
  unfollowUser(targetUserId: $userId) {
    id
    name
    username
    viewerEdge {
      id
      isFollowing
      __typename
    }
    __typename
  }
}`

export const UNSAVE_ARTICLE_MUTATION = `mutation RemoveFromPredefinedCatalog($type: PredefinedCatalogType!, $itemId: ID!) {
  removeFromPredefinedCatalog(type: $type, itemId: $itemId) {
    __typename
    ... on RemoveFromPredefinedCatalogSuccess {
      version
      __typename
    }
  }
}`
