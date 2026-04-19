import { describe, expect, it } from 'vitest'

import { TemplateError, createResponseStore, resolveTemplates } from './template-resolver.js'

describe('resolveTemplates', () => {
  it('passes through input with no placeholders', () => {
    const store = createResponseStore()
    const input = { a: 1, b: 'x', c: [1, 2, { d: true }] }
    expect(resolveTemplates(input, store)).toEqual(input)
  })

  it('whole-value mode preserves type (string)', () => {
    const store = createResponseStore()
    store.set('addToCart', { id: 'cart-item-42' })
    const out = resolveTemplates({ orderItemId: '${prev.addToCart.id}' }, store)
    expect(out).toEqual({ orderItemId: 'cart-item-42' })
  })

  it('whole-value mode preserves type (number)', () => {
    const store = createResponseStore()
    store.set('addToCart', { qty: 7 })
    const out = resolveTemplates({ quantity: '${prev.addToCart.qty}' }, store)
    expect(out).toEqual({ quantity: 7 })
    expect(typeof (out as { quantity: unknown }).quantity).toBe('number')
  })

  it('whole-value mode preserves type (object)', () => {
    const store = createResponseStore()
    store.set('savePin', { saved: { id: 'p1', board: 'b1' } })
    const out = resolveTemplates({ ref: '${prev.savePin.saved}' }, store)
    expect(out).toEqual({ ref: { id: 'p1', board: 'b1' } })
  })

  it('string interpolation coerces and concatenates', () => {
    const store = createResponseStore()
    store.set('addToCart', { id: 42 })
    const out = resolveTemplates({ url: '/items/${prev.addToCart.id}/remove' }, store)
    expect(out).toEqual({ url: '/items/42/remove' })
  })

  it('walks nested objects and arrays', () => {
    const store = createResponseStore()
    store.set('addToCart', { itemId: 'X' })
    const out = resolveTemplates(
      { wrap: { items: [{ id: '${prev.addToCart.itemId}' }] } },
      store,
    )
    expect(out).toEqual({ wrap: { items: [{ id: 'X' }] } })
  })

  it('resolves nested dot path', () => {
    const store = createResponseStore()
    store.set('addToCart', { data: { cart: { items: [{ id: 'A' }, { id: 'B' }] } } })
    const out = resolveTemplates(
      { id: '${prev.addToCart.data.cart.items.1.id}' },
      store,
    )
    expect(out).toEqual({ id: 'B' })
  })

  it('resolves bracket index notation', () => {
    const store = createResponseStore()
    store.set('addToCart', { items: [{ id: 'A' }, { id: 'B' }] })
    const out = resolveTemplates({ id: '${prev.addToCart.items[0].id}' }, store)
    expect(out).toEqual({ id: 'A' })
  })

  it('escapes $${...} as literal ${...}', () => {
    const store = createResponseStore()
    const out = resolveTemplates({ s: '$${prev.foo.bar}' }, store)
    expect(out).toEqual({ s: '${prev.foo.bar}' })
  })

  it('throws missing_dependency when op was not stored', () => {
    const store = createResponseStore()
    let err: TemplateError | undefined
    try {
      resolveTemplates({ x: '${prev.addToCart.id}' }, store)
    } catch (e) {
      err = e as TemplateError
    }
    expect(err).toBeInstanceOf(TemplateError)
    expect(err?.kind).toBe('missing_dependency')
  })

  it('throws missing_path when path does not resolve', () => {
    const store = createResponseStore()
    store.set('addToCart', { id: 'X' })
    let err: TemplateError | undefined
    try {
      resolveTemplates({ x: '${prev.addToCart.nope.deeper}' }, store)
    } catch (e) {
      err = e as TemplateError
    }
    expect(err).toBeInstanceOf(TemplateError)
    expect(err?.kind).toBe('missing_path')
  })

  it('throws bad_syntax for unclosed placeholder', () => {
    const store = createResponseStore()
    let err: TemplateError | undefined
    try {
      resolveTemplates({ x: '${prev.foo.bar' }, store)
    } catch (e) {
      err = e as TemplateError
    }
    expect(err).toBeInstanceOf(TemplateError)
    expect(err?.kind).toBe('bad_syntax')
  })

  it('throws bad_syntax for non-prev prefix', () => {
    const store = createResponseStore()
    let err: TemplateError | undefined
    try {
      resolveTemplates({ x: '${env.foo.bar}' }, store)
    } catch (e) {
      err = e as TemplateError
    }
    expect(err).toBeInstanceOf(TemplateError)
    expect(err?.kind).toBe('bad_syntax')
  })

  it('multiple placeholders in one string', () => {
    const store = createResponseStore()
    store.set('a', { v: 'X' })
    store.set('b', { v: 'Y' })
    const out = resolveTemplates({ s: '${prev.a.v}-${prev.b.v}' }, store)
    expect(out).toEqual({ s: 'X-Y' })
  })

  it('does not template object keys', () => {
    const store = createResponseStore()
    store.set('a', { v: 'X' })
    const input = { '${prev.a.v}': 1 }
    expect(resolveTemplates(input, store)).toEqual(input)
  })
})
