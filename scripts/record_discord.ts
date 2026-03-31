/**
 * Scripted recording for Discord APIs.
 *
 * Captures: user info, guilds, channels, messages, DMs, search, roles, pins.
 * Run via: pnpm dev compile https://discord.com --script scripts/record_discord.ts
 */
import { parseArgs } from 'node:util'

import { chromium } from 'playwright'

import { createCaptureSession } from '../src/capture/session.js'

const { values } = parseArgs({
  options: { out: { type: 'string' } },
  strict: false,
})
const outputDir = values.out
if (!outputDir) {
  process.stderr.write('Usage: record_discord.ts --out <dir>\n')
  process.exit(1)
}

const cdpPort = process.env.OPENWEB_CDP_PORT ?? '9222'
const cdpEndpoint = `http://localhost:${cdpPort}`

const browser = await chromium.connectOverCDP(cdpEndpoint)
const context = browser.contexts()[0]
if (!context) throw new Error('No browser context')

const page = await context.newPage()
const session = createCaptureSession({
  cdpEndpoint,
  outputDir,
  targetPage: page,
  isolateToTargetPage: true,
  onLog: (msg) => process.stderr.write(`${msg}\n`),
})
await session.ready

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Navigate to Discord (SPA must load for webpack modules)
// Use 'load' instead of 'networkidle' — Discord SPA keeps making requests, networkidle may never fire
process.stderr.write('navigating to Discord...\n')
await page.goto('https://discord.com/channels/@me', { waitUntil: 'load', timeout: 30_000 })
await wait(5000)

// Extract auth token from webpack module cache
process.stderr.write('extracting auth token...\n')
const token = await page.evaluate(() => {
  const wp = (window as Record<string, unknown>).webpackChunkdiscord_app as
    | Array<unknown>
    | undefined
  if (!wp || !Array.isArray(wp)) return null

  let found: string | null = null
  wp.push([
    [Symbol()],
    {},
    (r: { c?: Record<string, { exports?: Record<string, unknown> }> }) => {
      for (const id of Object.keys(r.c ?? {})) {
        const exp = r.c?.[id]?.exports
        if (!exp) continue
        for (const key of ['default', 'Z', 'ZP']) {
          const mod = exp[key] as Record<string, unknown> | undefined
          if (!mod) continue
          const fn = mod.getToken
          if (typeof fn === 'function') {
            const val = (fn as () => unknown).call(mod)
            if (typeof val === 'string' && val.length > 20) {
              found = val
              return
            }
          }
        }
      }
    },
  ])
  wp.pop()
  return found
})

if (!token) {
  process.stderr.write('ERROR: could not extract Discord auth token\n')
  session.stop()
  await session.done
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
    Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))])
  await withTimeout(page.close(), 5_000)
  await withTimeout(browser.close(), 5_000)
  process.exit(1)
}
process.stderr.write('got auth token\n')

// Helper: authenticated fetch via page.evaluate
async function discordFetch(path: string, label: string): Promise<unknown> {
  process.stderr.write(`  ${label}: ${path}\n`)
  const result = await page.evaluate(
    async (args: { path: string; token: string }) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const resp = await fetch(`https://discord.com${args.path}`, {
          headers: { Authorization: args.token },
          signal: controller.signal,
        })
        const text = await resp.text()
        return { status: resp.status, body: text }
      } finally {
        clearTimeout(timer)
      }
    },
    { path, token },
  )
  await wait(800)
  if (result.status !== 200) {
    process.stderr.write(`    WARNING: ${result.status}\n`)
  }
  try {
    return JSON.parse(result.body)
  } catch {
    return null
  }
}

// 1. Get current user
process.stderr.write('\n--- getCurrentUser ---\n')
await discordFetch('/api/v9/users/@me', 'getCurrentUser')

// 2. List guilds
process.stderr.write('\n--- listGuilds ---\n')
const guilds = (await discordFetch('/api/v9/users/@me/guilds', 'listGuilds')) as
  | Array<{ id: string; name: string }>
  | null

// 3. Get DM channels
process.stderr.write('\n--- getDirectMessages ---\n')
await discordFetch('/api/v9/users/@me/channels', 'getDirectMessages')

if (guilds && guilds.length > 0) {
  // Pick first two guilds for varied schema inference
  const targetGuilds = guilds.slice(0, 2)

  for (const guild of targetGuilds) {
    process.stderr.write(`\n=== Guild: ${guild.name} (${guild.id}) ===\n`)

    // 4. Get guild info
    await discordFetch(`/api/v9/guilds/${guild.id}`, 'getGuildInfo')

    // 5. List guild channels
    const channels = (await discordFetch(
      `/api/v9/guilds/${guild.id}/channels`,
      'listGuildChannels',
    )) as Array<{ id: string; type: number; name: string }> | null

    // 6. Get guild roles
    await discordFetch(`/api/v9/guilds/${guild.id}/roles`, 'getGuildRoles')

    // 7. Search messages
    await discordFetch(
      `/api/v9/guilds/${guild.id}/messages/search?content=hello`,
      'searchMessages',
    )
    await wait(500)
    await discordFetch(
      `/api/v9/guilds/${guild.id}/messages/search?content=test`,
      'searchMessages (variant 2)',
    )

    // Find text channels (type 0 = text)
    const textChannels = channels?.filter((c) => c.type === 0) ?? []
    const targetChannels = textChannels.slice(0, 2)

    for (const channel of targetChannels) {
      process.stderr.write(`\n  --- Channel: ${channel.name} (${channel.id}) ---\n`)

      // 8. Get channel info
      await discordFetch(`/api/v9/channels/${channel.id}`, 'getChannelInfo')

      // 9. Get channel messages (varied limit params)
      await discordFetch(
        `/api/v9/channels/${channel.id}/messages?limit=50`,
        'getChannelMessages',
      )
      await wait(300)
      await discordFetch(
        `/api/v9/channels/${channel.id}/messages?limit=10`,
        'getChannelMessages (variant)',
      )

      // 10. Get pinned messages
      await discordFetch(`/api/v9/channels/${channel.id}/pins`, 'getPinnedMessages')
    }
  }
} else {
  process.stderr.write('WARNING: no guilds found\n')
}

process.stderr.write('\n--- capture complete ---\n')
session.stop()
await session.done

// Bounded cleanup — don't let page/browser close hang or crash the process
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p.catch(() => {}), new Promise<void>((r) => setTimeout(r, ms))])
await withTimeout(page.close(), 5_000)
await withTimeout(browser.close(), 5_000)
process.exit(0)