import { describe, expect, it } from 'vitest'

import type { RecordedRequestSample } from '../types.js'
import { detectGraphqlEndpoint, subClusterGraphql } from './graphql-cluster.js'

function makeSample(overrides: Partial<RecordedRequestSample> = {}): RecordedRequestSample {
  return {
    method: 'POST',
    host: 'api.example.com',
    path: '/graphql',
    url: 'https://api.example.com/graphql',
    query: {},
    status: 200,
    contentType: 'application/json',
    response: { kind: 'json', body: { data: {} } },
    ...overrides,
  }
}

describe('detectGraphqlEndpoint', () => {
  it('returns true when path contains "graphql"', () => {
    const samples = [makeSample(), makeSample()]
    expect(detectGraphqlEndpoint(samples)).toBe(true)
  })

  it('returns true for case-insensitive path match', () => {
    const samples = [
      makeSample({ path: '/api/GraphQL', url: 'https://api.example.com/api/GraphQL' }),
      makeSample({ path: '/api/GraphQL', url: 'https://api.example.com/api/GraphQL' }),
    ]
    expect(detectGraphqlEndpoint(samples)).toBe(true)
  })

  it('returns true for POST with GraphQL body fields on non-graphql path', () => {
    const samples = [
      makeSample({
        path: '/api/v1',
        url: 'https://api.example.com/api/v1',
        requestBody: JSON.stringify({ query: '{ user { id } }' }),
      }),
      makeSample({
        path: '/api/v1',
        url: 'https://api.example.com/api/v1',
        requestBody: JSON.stringify({ operationName: 'GetUser', query: '{ user { id } }' }),
      }),
    ]
    expect(detectGraphqlEndpoint(samples)).toBe(true)
  })

  it('returns false for different paths', () => {
    const samples = [
      makeSample({ path: '/graphql' }),
      makeSample({ path: '/api/users' }),
    ]
    expect(detectGraphqlEndpoint(samples)).toBe(false)
  })

  it('returns false for non-GraphQL REST endpoints', () => {
    const samples = [
      makeSample({
        method: 'GET',
        path: '/api/users',
        url: 'https://api.example.com/api/users',
      }),
      makeSample({
        method: 'GET',
        path: '/api/users',
        url: 'https://api.example.com/api/users',
      }),
    ]
    expect(detectGraphqlEndpoint(samples)).toBe(false)
  })

  it('returns false for empty samples', () => {
    expect(detectGraphqlEndpoint([])).toBe(false)
  })

  it('returns false for GET without graphql in path', () => {
    const samples = [
      makeSample({
        method: 'GET',
        path: '/api/data',
        url: 'https://api.example.com/api/data',
        requestBody: JSON.stringify({ query: '{ user { id } }' }),
      }),
    ]
    expect(detectGraphqlEndpoint(samples)).toBe(false)
  })
})

describe('subClusterGraphql', () => {
  it('returns empty for empty samples', () => {
    expect(subClusterGraphql([])).toEqual([])
  })

  describe('LinkedIn-style: GET /graphql?queryId=...', () => {
    it('sub-clusters by queryId from query params', () => {
      const samples = [
        makeSample({
          method: 'GET',
          query: { queryId: ['voyagerSearchDashClusters'] },
          requestBody: undefined,
        }),
        makeSample({
          method: 'GET',
          query: { queryId: ['voyagerSearchDashClusters'] },
          requestBody: undefined,
        }),
        makeSample({
          method: 'GET',
          query: { queryId: ['voyagerIdentityDashProfiles'] },
          requestBody: undefined,
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(2)

      const search = clusters.find((c) => c.graphql.queryId === 'voyagerSearchDashClusters')
      expect(search).toBeDefined()
      expect(search?.samples).toHaveLength(2)
      expect(search?.graphql.discriminator).toBe('queryId')

      const profile = clusters.find((c) => c.graphql.queryId === 'voyagerIdentityDashProfiles')
      expect(profile).toBeDefined()
      expect(profile?.samples).toHaveLength(1)
    })

    it('detects operation type from queryId prefix', () => {
      const samples = [
        makeSample({
          method: 'GET',
          query: { queryId: ['mutationSendMessage'] },
          requestBody: undefined,
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters[0].graphql.operationType).toBe('mutation')
    })
  })

  describe('Standard: POST /graphql with operationName', () => {
    it('sub-clusters by operationName', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({
            operationName: 'SearchUsers',
            query: 'query SearchUsers { search { id name } }',
            variables: { term: 'alice' },
          }),
        }),
        makeSample({
          requestBody: JSON.stringify({
            operationName: 'SearchUsers',
            query: 'query SearchUsers { search { id name } }',
            variables: { term: 'bob' },
          }),
        }),
        makeSample({
          requestBody: JSON.stringify({
            operationName: 'GetProfile',
            query: 'query GetProfile($id: ID!) { user(id: $id) { name } }',
            variables: { id: '123' },
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(2)

      const search = clusters.find((c) => c.graphql.operationName === 'SearchUsers')
      expect(search).toBeDefined()
      expect(search?.samples).toHaveLength(2)
      expect(search?.graphql.discriminator).toBe('operationName')
      expect(search?.graphql.operationType).toBe('query')
    })

    it('detects mutation operation type', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({
            operationName: 'UpdateUser',
            query: 'mutation UpdateUser($id: ID!, $name: String!) { updateUser(id: $id, name: $name) { id } }',
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters[0].graphql.operationType).toBe('mutation')
      expect(clusters[0].graphql.operationName).toBe('UpdateUser')
    })
  })

  describe('APQ: POST /graphql with persistedQuery hash', () => {
    it('sub-clusters by persistedQuery sha256Hash', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({
            extensions: {
              persistedQuery: { version: 1, sha256Hash: 'abc123def456' },
            },
          }),
        }),
        makeSample({
          requestBody: JSON.stringify({
            extensions: {
              persistedQuery: { version: 1, sha256Hash: 'abc123def456' },
            },
          }),
        }),
        makeSample({
          requestBody: JSON.stringify({
            extensions: {
              persistedQuery: { version: 1, sha256Hash: 'xyz789ghi012' },
            },
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(2)

      const first = clusters.find((c) => c.graphql.persistedQueryHash === 'abc123def456')
      expect(first).toBeDefined()
      expect(first?.samples).toHaveLength(2)
      expect(first?.graphql.discriminator).toBe('persistedQueryHash')

      const second = clusters.find((c) => c.graphql.persistedQueryHash === 'xyz789ghi012')
      expect(second).toBeDefined()
      expect(second?.samples).toHaveLength(1)
    })
  })

  describe('Mixed discriminator types', () => {
    it('handles samples with different discriminator types on same endpoint', () => {
      const samples = [
        // queryId-based (highest priority for this sample)
        makeSample({
          method: 'GET',
          query: { queryId: ['voyagerSearch'] },
          requestBody: undefined,
        }),
        // operationName-based
        makeSample({
          requestBody: JSON.stringify({
            operationName: 'GetProfile',
            query: 'query GetProfile { me { id } }',
          }),
        }),
        // APQ-based
        makeSample({
          requestBody: JSON.stringify({
            extensions: { persistedQuery: { sha256Hash: 'hash123' } },
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(3)

      expect(clusters.find((c) => c.graphql.discriminator === 'queryId')).toBeDefined()
      expect(clusters.find((c) => c.graphql.discriminator === 'operationName')).toBeDefined()
      expect(clusters.find((c) => c.graphql.discriminator === 'persistedQueryHash')).toBeDefined()
    })
  })

  describe('Parsed operation name from query text', () => {
    it('extracts operation name when operationName field is absent', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({
            query: 'query FetchUser($id: ID!) { user(id: $id) { name } }',
          }),
        }),
        makeSample({
          requestBody: JSON.stringify({
            query: 'mutation CreatePost($title: String!) { createPost(title: $title) { id } }',
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(2)

      const fetch = clusters.find((c) => c.graphql.operationName === 'FetchUser')
      expect(fetch).toBeDefined()
      expect(fetch?.graphql.discriminator).toBe('operationName')
      expect(fetch?.graphql.operationType).toBe('query')

      const create = clusters.find((c) => c.graphql.operationName === 'CreatePost')
      expect(create).toBeDefined()
      expect(create?.graphql.operationType).toBe('mutation')
    })
  })

  describe('Query shape fallback', () => {
    it('groups by query hash when no other discriminator found', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({ query: '{ user { id name } }' }),
        }),
        makeSample({
          requestBody: JSON.stringify({ query: '{ user { id name } }' }),
        }),
        makeSample({
          requestBody: JSON.stringify({ query: '{ posts { id title } }' }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(2)

      const userCluster = clusters.find((c) => c.samples.length === 2)
      expect(userCluster).toBeDefined()
      expect(userCluster?.graphql.discriminator).toBe('queryShape')
    })
  })

  describe('Priority: operationName field over parsed query name', () => {
    it('uses operationName field when both are available', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({
            operationName: 'MyOp',
            query: 'query DifferentName { me { id } }',
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(1)
      // operationName field takes priority over parsed query name
      expect(clusters[0].graphql.operationName).toBe('MyOp')
      expect(clusters[0].graphql.discriminator).toBe('operationName')
    })
  })

  describe('Subscription detection', () => {
    it('detects subscription operation type', () => {
      const samples = [
        makeSample({
          requestBody: JSON.stringify({
            query: 'subscription OnMessage { messageAdded { id text } }',
          }),
        }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters[0].graphql.operationType).toBe('subscription')
      expect(clusters[0].graphql.operationName).toBe('OnMessage')
    })
  })

  describe('Edge cases', () => {
    it('handles samples with no request body', () => {
      const samples = [
        makeSample({ requestBody: undefined }),
        makeSample({ requestBody: undefined }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(1)
      expect(clusters[0].graphql.discriminator).toBe('queryShape')
    })

    it('handles invalid JSON in request body', () => {
      const samples = [
        makeSample({ requestBody: 'not-json' }),
      ]

      const clusters = subClusterGraphql(samples)
      expect(clusters).toHaveLength(1)
      expect(clusters[0].graphql.discriminator).toBe('queryShape')
    })
  })
})
