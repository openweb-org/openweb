import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile, readdir, cp, rm, mkdtemp } from 'node:fs/promises'

import { parse, stringify } from 'yaml'

import { discover, type DiscoverResult } from '../discovery/pipeline.js'
import { type OpenApiSpec, type OpenApiOperation } from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'
import { resolveSiteRoot } from '../lib/openapi.js'
import { derivePermissionFromMethod } from '../lib/permission-derive.js'
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

/** Drift types that represent actual API changes (healable via re-discovery). */
const HEALABLE_DRIFT_TYPES = new Set(['schema_drift', 'endpoint_removed'])

/** Derive permission: prefer x-openweb.permission, fall back to method+path heuristic. */
function derivePermission(op: OpenApiOperation, method: string, apiPath: string): string {
  const xow = op['x-openweb']
  if (typeof xow?.permission === 'string') return xow.permission
  return derivePermissionFromMethod(method, apiPath)
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
 * - Only heals schema_drift and endpoint_removed (not runtime errors)
 * - Auth failures don't trigger heal
 * - CAPTCHA/login wall aborts heal
 * - Writes to staging dir first, archives, then publishes to siteRoot
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

  // Only heal actual API drift (schema_drift, endpoint_removed), not runtime errors
  const driftedOps = verifyResult.operations.filter(
    (o) => o.driftType !== undefined && HEALABLE_DRIFT_TYPES.has(o.driftType),
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
    await cleanupDir(discoverResult.outputRoot)
    return {
      site, healed, reported,
      failed: [`human_handoff: ${discoverResult.humanHandoff.type}`],
    }
  }

  if (discoverResult.operationCount === 0) {
    await cleanupDir(discoverResult.outputRoot)
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

  // Build merged paths: read ops get new version, write/delete/transact keep old
  const mergedPaths: Record<string, Record<string, unknown>> = {}

  for (const [apiPath, methods] of Object.entries(oldSpec.paths ?? {})) {
    mergedPaths[apiPath] = {}
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      const typedOp = op as OpenApiOperation
      const opId = typedOp.operationId
      const key = opKey(method, apiPath)

      if (opId && driftedIds.has(opId)) {
        const permission = derivePermission(typedOp, method, apiPath)
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
    await cleanupDir(discoverResult.outputRoot)
    return { site, healed, reported, failed }
  }

  // Build staged fixture in temp dir (never mutate siteRoot until archive succeeds)
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-heal-'))
  try {
    // Copy current fixture as base
    await cp(siteRoot, stagingDir, { recursive: true })

    // Write merged spec to staging
    const mergedSpec = { ...oldSpec, paths: mergedPaths }
    await writeFile(path.join(stagingDir, 'openapi.yaml'), stringify(mergedSpec), 'utf8')

    // Copy healed test files from discovery to staging
    await copyHealedTests(discoverResult.outputRoot, stagingDir, healed)

    // Archive from staging → registry (siteRoot untouched if this fails)
    const newVersion = await archiveWithBump(site, stagingDir)
    log(`archived v${newVersion}`)

    // Success: publish staging to siteRoot
    await cp(stagingDir, siteRoot, { recursive: true, force: true })

    await cleanupDir(stagingDir)
    await cleanupDir(discoverResult.outputRoot)
    return { site, healed, reported, failed, newVersion }
  } catch (error) {
    // Archive or publish failed: siteRoot is untouched
    await cleanupDir(stagingDir)
    await cleanupDir(discoverResult.outputRoot)
    failed.push(`archive_failed: ${error instanceof Error ? error.message : String(error)}`)
    return { site, healed, reported, failed }
  }
}

async function copyHealedTests(
  newRoot: string,
  targetRoot: string,
  healedOpIds: string[],
): Promise<void> {
  const healedSet = new Set(healedOpIds)
  const newTestsDir = path.join(newRoot, 'tests')
  const targetTestsDir = path.join(targetRoot, 'tests')

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
        await cp(path.join(newTestsDir, fileName), path.join(targetTestsDir, fileName), { force: true })
      }
    } catch {
      // non-fatal: test copy failure doesn't block heal
    }
  }
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    // non-fatal
  }
}
