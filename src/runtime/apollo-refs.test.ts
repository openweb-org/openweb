import { describe, expect, it } from 'vitest'

import { resolveApolloRefs } from './apollo-refs.js'

type Rec = Record<string, unknown>

describe('resolveApolloRefs', () => {
  it('resolves a 2-level __ref chain into a flat object', () => {
    const cache: Rec = {
      'Book:123': {
        __typename: 'Book',
        id: '123',
        title: 'Dune',
        primaryContributorEdge: {
          node: { __ref: 'Contributor:456' },
        },
        bookSeries: [
          { series: { __ref: 'Series:789' }, userPosition: '1' },
        ],
      },
      'Contributor:456': {
        __typename: 'Contributor',
        id: '456',
        name: 'Frank Herbert',
        profile: { __ref: 'Profile:999' },
      },
      'Profile:999': {
        __typename: 'Profile',
        bio: 'Author of Dune',
      },
      'Series:789': {
        __typename: 'Series',
        title: 'Dune Chronicles',
      },
    }

    const resolved = resolveApolloRefs(cache['Book:123'], cache) as Rec
    const edge = resolved.primaryContributorEdge as Rec
    const node = edge.node as Rec
    const profile = node.profile as Rec
    const series = (resolved.bookSeries as Rec[])[0]
    const seriesEntity = series.series as Rec

    expect(resolved.title).toBe('Dune')
    expect(node.name).toBe('Frank Herbert')
    expect(profile.bio).toBe('Author of Dune')
    expect(seriesEntity.title).toBe('Dune Chronicles')
    expect(series.userPosition).toBe('1')
  })

  it('leaves unresolvable refs in place', () => {
    const cache: Rec = {
      'Book:1': { title: 'X', author: { __ref: 'Missing:1' } },
    }
    const resolved = resolveApolloRefs(cache['Book:1'], cache) as Rec
    expect(resolved.author).toEqual({ __ref: 'Missing:1' })
  })

  it('breaks cycles safely', () => {
    const cache: Rec = {
      'A:1': { name: 'A', other: { __ref: 'B:1' } },
      'B:1': { name: 'B', other: { __ref: 'A:1' } },
    }
    const resolved = resolveApolloRefs(cache['A:1'], cache) as Rec
    const o1 = resolved.other as Rec
    const o2 = o1.other as Rec
    expect(resolved.name).toBe('A')
    expect(o1.name).toBe('B')
    expect(o2.other).toEqual({ __ref: 'B:1' })
  })
})
