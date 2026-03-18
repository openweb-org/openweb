import { listSites, listOperations, loadOpenApi, resolveSiteRoot } from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'
import { getServerXOpenWeb, resolveTransport } from '../runtime/operation-context.js'
import { derivePermissionFromMethod } from '../lib/permission-derive.js'
import type { PermissionCategory } from '../types/extensions.js'

export interface SitesOptions {
  readonly json?: boolean
}

export async function sitesCommand(options: SitesOptions = {}): Promise<void> {
  const sites = await listSites()
  if (sites.length === 0) {
    if (options.json) {
      process.stdout.write('[]\n')
    } else {
      process.stdout.write('No sites found.\n')
    }
    return
  }

  if (options.json) {
    const result = await Promise.all(sites.map(async (site) => {
      try {
        const spec = await loadOpenApi(site)
        const operations = listOperations(spec)
        const firstOp = operations[0]
        const serverExt = firstOp ? getServerXOpenWeb(spec, firstOp.operation) : undefined
        const transport = firstOp ? resolveTransport(spec, firstOp.operation) : 'node'

        // Aggregate highest permission category
        let maxPerm: PermissionCategory = 'read'
        for (const entry of operations) {
          const opExt = entry.operation['x-openweb'] as Record<string, unknown> | undefined
          const perm = (opExt?.permission as PermissionCategory | undefined) ?? derivePermissionFromMethod(entry.method, entry.path) as PermissionCategory
          if (perm === 'transact') { maxPerm = 'transact'; break }
          if (perm === 'delete' && maxPerm !== 'transact') maxPerm = 'delete'
          if (perm === 'write' && maxPerm === 'read') maxPerm = 'write'
        }

        return {
          name: site,
          transport,
          operationCount: operations.length,
          permission: maxPerm,
        }
      } catch {
        return { name: site, transport: 'unknown', operationCount: 0, permission: 'read' }
      }
    }))

    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }

  for (const site of sites) {
    let suffix = ''
    try {
      const root = await resolveSiteRoot(site)
      const manifest = await loadManifest(root)
      if (manifest?.quarantined) {
        suffix = ' ⚠️  quarantined'
      }
    } catch { /* ignore */ }
    process.stdout.write(`${site}${suffix}\n`)
  }
}
