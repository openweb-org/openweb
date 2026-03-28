import { describe, expect, it } from 'vitest'

import { annotateOperation } from './annotate.js'

describe('annotateOperation', () => {
  it('generates heuristic operationId for any endpoint', () => {
    const annotation = annotateOperation('api.open-meteo.com', '/v1/forecast')
    expect(annotation.operationId).toBe('getForecast')
  })

  it('generates list prefix for plural collection endpoints', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users')
    expect(a.operationId).toBe('listUsers')
    expect(a.summary).toBe('List users')
  })

  it('generates get prefix for singular endpoints', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/me')
    expect(a.operationId).toBe('getMe')
  })

  it('generates get prefix for path-param endpoints', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/{id}')
    expect(a.operationId).toBe('getUser')
  })

  it('generates create prefix for POST method', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users', 'POST')
    expect(a.operationId).toBe('createUsers')
  })

  it('generates update prefix for PUT method', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/{id}', 'PUT')
    expect(a.operationId).toBe('updateUser')
  })

  it('generates delete prefix for DELETE method', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/{id}', 'DELETE')
    expect(a.operationId).toBe('deleteUser')
  })

  it('detects search operations', () => {
    const a = annotateOperation('api.example.com', '/api/v1/search')
    expect(a.operationId).toBe('search')
  })

  it('handles nested resources', () => {
    const a = annotateOperation('api.example.com', '/repos/{owner}/{repo}/issues')
    expect(a.operationId).toBe('listReposIssues')
  })

  it('skips version and noise segments', () => {
    const a = annotateOperation('api.example.com', '/api/v2/rest/items')
    expect(a.operationId).toBe('listItems')
  })

  it('generates summary from operationId', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users')
    expect(a.summary).toBe('List users')
  })
})
