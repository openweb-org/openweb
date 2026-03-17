import path from 'node:path'
import { readFile, writeFile, readdir, cp, rm } from 'node:fs/promises'

import { parse, stringify } from 'yaml'

import { discover, type DiscoverResult } from '../discovery/pipeline.js'
import { type OpenApiSpec, type OpenApiOperation } from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'
import { resolveSiteRoot } from '../lib/openapi.js'
import { archiveWithBump } from './registry.js'
import { resolveCdpEndpoint } from '../commands/browser.js'
import type { SiteVerifyResult } from './verify.js'

export interface HealResult {
  readonly site: string
  readonly healed: string[]
  readonly reported: string[]
  readonly failed: string[]
  readonly newVersion?: string
}

/** Derive permission from x-openweb extension or HTTP method. */
function derivePermission(op: OpenApiOperation, method: string): string {
  const xow = op['x-openweb']
  if (typeof xow?.permission === 'string') return xow.permission
  const m = method.toLowerCase()
  if (m === 'delete') return 'delete'
  if (['post', 'put', 'patch'].includes(m)) return 'write'
  return 'read'
}

function opKey(method: string, apiPath: string): string {
  return `${method.toUpperCase()}:${apiPath}`
}

/**
 * Heal a drifted site by re-discovering and selectively accepting read operations.
 *
 * Safety constraints:
 * - Only auto-heals read operations (permission: 'read')
 * - Write/delete/transact operations are reported, not updated
 * - Auth failures don't trigger heal (caller checks overallStatus)
 * - CAPTCHA/login wall aborts heal
 */
export async function healSite(
  site: string,
  verifyResult: SiteVerifyResult,
  opts?: { cdpEndpoint?: string; onLog?: (msg: string) => void },
): Promise<HealResult> {
  const log = opts?.onLog ?? (() => {})
  const healed: string[] = []
  const reported: string[] = []
  const failed: string[] = []

  const siteRoot = await resolveSiteRoot(site)
  const manifest = await loadManifest(siteRoot)
  if (!manifest?.site_url) {
    return { site, healed, reported, failed: ['no_site_url'] }
  }

  // Filter to drifted operations (exclude auth_drift — needs re-login, not re-discover)
  const driftedOps = verifyResult.operations.filter(
    (o) => o.status === 'DRIFT' || (o.status === 'FAIL' && o.driftType !== 'auth_drift'),
  )
  if (driftedOps.length === 0) {
    return { site, healed, reported, failed }
  }

  // Resolve CDP endpoint (managed browser must be running)
  let cdpEndpoint: string
  try {
    cdpEndpoint = opts?.cdpEndpoint ?? (await resolveCdpEndpoint())
  } catch {
    return { site, healed, reported, failed: ['no_browser'] }
  }

  // Re-discover with exploration
  log(`re-discovering ${site}...`)
  let discoverResult: DiscoverResult
  try {
    discoverResult = await discover({
      cdpEndpoint,
      targetUrl: manifest.site_url,
      explore: true,
      onLog: (msg) => log(`  [discover] ${msg}`),
    })
  } catch (error) {
    return {
      site, healed, reported,
      failed: [`discover_failed: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  // Abort on human handoff (CAPTCHA, 2FA, login wall)
  if (discoverResult.humanHandoff) {
    log(`human_handoff: ${discoverResult.humanHandoff.type}`)
    await cleanupDiscovery(discoverResult.outputRoot)
    return {
      site, healed, reported,
      failed: [`human_handoff: ${discoverResult.humanHandoff.type}`],
    }
  }

  if (discoverResult.operationCount === 0) {
    await cleanupDiscovery(discoverResult.outputRoot)
    return { site, healed, reported, failed: ['no_operations_discovered'] }
  }

  // Load old and new specs
  const oldSpecRaw = await readFile(path.join(siteRoot, 'openapi.yaml'), 'utf8')
  const oldSpec = parse(oldSpecRaw) as OpenApiSpec

  const newSpecRaw = await readFile(path.join(discoverResult.outputRoot, 'openapi.yaml'), 'utf8')
  const newSpec = parse(newSpecRaw) as OpenApiSpec

  const driftedIds = new Set(driftedOps.map((o) => o.operationId))

  // Index new operations by "METHOD:/path" for lookup
  const newOpByKey = new Map<string, unknown>()
  for (const [apiPath, methods] of Object.entries(newSpec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      newOpByKey.set(opKey(method, apiPath), op)
    }
  }

  // Build merged paths: read ops get new version, write ops keep old
  const mergedPaths: Record<string, Record<string, unknown>> = {}

  for (const [apiPath, methods] of Object.entries(oldSpec.paths ?? {})) {
    mergedPaths[apiPath] = {}
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      const typedOp = op as OpenApiOperation
      const opId = typedOp.operationId
      const key = opKey(method, apiPath)

      if (opId && driftedIds.has(opId)) {
        const permission = derivePermission(typedOp, method)
        if (permission === 'read') {
          const newOp = newOpByKey.get(key)
          if (newOp) {
            mergedPaths[apiPath]![method] = newOp
            healed.push(opId)
            log(`  healed: ${opId}`)
          } else {
            mergedPaths[apiPath]![method] = op
            failed.push(opId)
            log(`  failed: ${opId} — not in new discovery`)
          }
        } else {
          mergedPaths[apiPath]![method] = op
          reported.push(opId)
          log(`  reported: ${opId} (${permission})`)
        }
      } else {
        mergedPaths[apiPath]![method] = op
      }
    }
  }

  if (healed.length === 0) {
    await cleanupDiscovery(discoverResult.outputRoot)
    return { site, healed, reported, failed }
  }

  // Write merged spec
  const mergedSpec = { ...oldSpec, paths: mergedPaths }
  await writeFile(path.join(siteRoot, 'openapi.yaml'), stringify(mergedSpec), 'utf8')

  // Copy test files for healed operations only
  await copyHealedTests(discoverResult.outputRoot, siteRoot, healed)

  // Archive with version bump
  let newVersion: string | undefined
  try {
    newVersion = await archiveWithBump(site, siteRoot)
    log(`archived v${newVersion}`)
  } catch {
    // non-fatal: heal succeeded even if archive fails
  }

  await cleanupDiscovery(discoverResult.outputRoot)
  return { site, healed, reported, failed, newVersion }
}

async function copyHealedTests(
  newRoot: string,
  oldRoot: string,
  healedOpIds: string[],
): Promise<void> {
  const healedSet = new Set(healedOpIds)
  const newTestsDir = path.join(newRoot, 'tests')
  const oldTestsDir = path.join(oldRoot, 'tests')

  let testFiles: string[]
  try {
    testFiles = (await readdir(newTestsDir)).filter((f) => f.endsWith('.test.json'))
  } catch {
    return
  }

  for (const fileName of testFiles) {
    try {
      const raw = await readFile(path.join(newTestsDir, fileName), 'utf8')
      const testFile = JSON.parse(raw) as { operation_id?: string }
      if (testFile.operation_id && healedSet.has(testFile.operation_id)) {
        await cp(path.join(newTestsDir, fileName), path.join(oldTestsDir, fileName), { force: true })
      }
    } catch {
      // non-fatal: test copy failure doesn't block heal
    }
  }
}

async function cleanupDiscovery(outputRoot: string): Promise<void> {
  try {
    await rm(outputRoot, { recursive: true, force: true })
  } catch {
    // non-fatal
  }
}
