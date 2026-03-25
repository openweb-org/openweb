import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { stringify } from 'yaml'

import { loadSitePackage, findOperationEntry } from '../lib/site-package.js'

// Minimal valid OpenAPI spec
const minimalOpenApi = {
  openapi: '3.0.3',
  info: { title: 'Test HTTP API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        summary: 'List items',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/items/{id}': {
      post: {
        operationId: 'createItem',
        summary: 'Create item',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

// Minimal valid AsyncAPI spec
const minimalAsyncApi = {
  asyncapi: '3.0.0',
  info: { title: 'Test WS API', version: '1.0.0' },
  servers: {
    main: {
      host: 'ws.example.com',
      pathname: '/v1/stream',
      protocol: 'wss',
      'x-openweb': {
        transport: 'node',
        discriminator: { sent: { field: 'action' }, received: null },
      },
    },
  },
  channels: {
    stream: {
      address: '/v1/stream',
      messages: {
        subscribe: { '$ref': '#/components/messages/Subscribe' },
      },
    },
  },
  operations: {
    subscribe_prices: {
      action: 'send',
      summary: 'Subscribe to prices',
      channel: { '$ref': '#/channels/stream' },
      'x-openweb': {
        permission: 'read',
        pattern: 'subscribe',
        subscribe_message: {
          constants: { action: 'subscribe' },
          bindings: [{ path: 'symbols', source: 'param', key: 'symbols' }],
        },
      },
      messages: [{ '$ref': '#/channels/stream/messages/subscribe' }],
    },
    receive_events: {
      action: 'receive',
      summary: 'Receive events',
      channel: { '$ref': '#/channels/stream' },
      'x-openweb': {
        permission: 'read',
        pattern: 'stream',
      },
    },
  },
  components: {
    messages: {
      Subscribe: {
        payload: {
          type: 'object',
          properties: {
            action: { const: 'subscribe' },
            symbols: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
}

describe('site-package', () => {
  let tmpRoot: string
  let wsOnlyDir: string
  let mixedDir: string
  let httpOnlyDir: string

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'site-pkg-'))

    // WS-only site (no openapi.yaml)
    wsOnlyDir = path.join(tmpRoot, 'ws-only-test')
    await mkdir(wsOnlyDir, { recursive: true })
    await writeFile(path.join(wsOnlyDir, 'manifest.json'), JSON.stringify({
      name: 'ws-only-test',
      version: '1.0.0',
      spec_version: '2.0',
    }))
    await writeFile(path.join(wsOnlyDir, 'asyncapi.yaml'), stringify(minimalAsyncApi))

    // Mixed site (both specs)
    mixedDir = path.join(tmpRoot, 'mixed-test')
    await mkdir(mixedDir, { recursive: true })
    await writeFile(path.join(mixedDir, 'manifest.json'), JSON.stringify({
      name: 'mixed-test',
      version: '1.0.0',
      spec_version: '2.0',
    }))
    await writeFile(path.join(mixedDir, 'openapi.yaml'), stringify(minimalOpenApi))
    await writeFile(path.join(mixedDir, 'asyncapi.yaml'), stringify(minimalAsyncApi))

    // HTTP-only site
    httpOnlyDir = path.join(tmpRoot, 'http-only-test')
    await mkdir(httpOnlyDir, { recursive: true })
    await writeFile(path.join(httpOnlyDir, 'manifest.json'), JSON.stringify({
      name: 'http-only-test',
      version: '1.0.0',
      spec_version: '2.0',
    }))
    await writeFile(path.join(httpOnlyDir, 'openapi.yaml'), stringify(minimalOpenApi))

    // Wire them up as "dev sites" by creating symlinks under src/sites/
    const sitesDir = path.join(process.cwd(), 'src', 'sites')
    const links = ['ws-only-test', 'mixed-test', 'http-only-test']
    for (const name of links) {
      const linkPath = path.join(sitesDir, name)
      const { symlink } = await import('node:fs/promises')
      try { await rm(linkPath, { force: true }) } catch {}
      await symlink(path.join(tmpRoot, name), linkPath)
    }
  })

  afterAll(async () => {
    // Clean up symlinks
    const sitesDir = path.join(process.cwd(), 'src', 'sites')
    for (const name of ['ws-only-test', 'mixed-test', 'http-only-test']) {
      try { await rm(path.join(sitesDir, name), { force: true }) } catch {}
    }
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('loads WS-only site without openapi.yaml', async () => {
    const pkg = await loadSitePackage('ws-only-test')

    expect(pkg.site).toBe('ws-only-test')
    expect(pkg.openapi).toBeUndefined()
    expect(pkg.asyncapi).toBeDefined()
    expect(pkg.operations.size).toBe(2)

    const sub = pkg.operations.get('subscribe_prices')
    expect(sub).toBeDefined()
    expect(sub!.protocol).toBe('ws')
    expect((sub as { pattern: string }).pattern).toBe('subscribe')
  })

  it('loads mixed site with both HTTP and WS operations', async () => {
    const pkg = await loadSitePackage('mixed-test')

    expect(pkg.openapi).toBeDefined()
    expect(pkg.asyncapi).toBeDefined()

    // 2 HTTP + 2 WS = 4
    expect(pkg.operations.size).toBe(4)

    const httpOp = pkg.operations.get('listItems')
    expect(httpOp).toBeDefined()
    expect(httpOp!.protocol).toBe('http')

    const wsOp = pkg.operations.get('subscribe_prices')
    expect(wsOp).toBeDefined()
    expect(wsOp!.protocol).toBe('ws')
  })

  it('loads HTTP-only site without asyncapi.yaml', async () => {
    const pkg = await loadSitePackage('http-only-test')

    expect(pkg.openapi).toBeDefined()
    expect(pkg.asyncapi).toBeUndefined()
    expect(pkg.operations.size).toBe(2)

    for (const entry of pkg.operations.values()) {
      expect(entry.protocol).toBe('http')
    }
  })

  it('findOperationEntry returns correct entry', async () => {
    const pkg = await loadSitePackage('mixed-test')

    const httpEntry = findOperationEntry(pkg, 'listItems')
    expect(httpEntry.protocol).toBe('http')

    const wsEntry = findOperationEntry(pkg, 'subscribe_prices')
    expect(wsEntry.protocol).toBe('ws')
  })

  it('findOperationEntry throws for unknown operation', async () => {
    const pkg = await loadSitePackage('mixed-test')
    expect(() => findOperationEntry(pkg, 'nonexistent')).toThrow('Operation not found: nonexistent')
  })

  it('WS operations have correct permission from x-openweb', async () => {
    const pkg = await loadSitePackage('ws-only-test')
    const sub = pkg.operations.get('subscribe_prices')
    expect(sub!.permission).toBe('read')
  })
})
