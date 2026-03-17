import { describe, expect, it } from 'vitest'

import { annotateOperation } from './annotate.js'

describe('annotateOperation', () => {
  it('returns known mapping for open-meteo endpoints', () => {
    const annotation = annotateOperation('api.open-meteo.com', '/v1/forecast')
    expect(annotation.operationId).toBe('get_forecast')
  })

  it('generates list_ prefix for plural collection endpoints', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users')
    expect(a.operationId).toBe('list_users')
    expect(a.summary).toBe('List users')
  })

  it('generates get_ prefix for singular endpoints', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/me')
    expect(a.operationId).toBe('get_me')
  })

  it('generates get_ prefix for path-param endpoints', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/{id}')
    expect(a.operationId).toBe('get_user')
  })

  it('generates create_ for POST method', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users', 'POST')
    expect(a.operationId).toBe('create_users')
  })

  it('generates update_ for PUT method', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/{id}', 'PUT')
    expect(a.operationId).toBe('update_user')
  })

  it('generates delete_ for DELETE method', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users/{id}', 'DELETE')
    expect(a.operationId).toBe('delete_user')
  })

  it('detects search operations', () => {
    const a = annotateOperation('api.example.com', '/api/v1/search')
    expect(a.operationId).toBe('search')
  })

  it('handles nested resources', () => {
    const a = annotateOperation('api.example.com', '/repos/{owner}/{repo}/issues')
    expect(a.operationId).toBe('list_repos_issues')
  })

  it('skips version and noise segments', () => {
    const a = annotateOperation('api.example.com', '/api/v2/rest/items')
    expect(a.operationId).toBe('list_items')
  })

  it('generates summary from operationId', () => {
    const a = annotateOperation('api.example.com', '/api/v1/users')
    expect(a.summary).toBe('List users')
  })
})
