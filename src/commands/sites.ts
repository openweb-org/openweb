import { listSites, resolveSiteRoot } from '../lib/openapi.js'
import { loadManifest } from '../lib/manifest.js'

export async function sitesCommand(): Promise<void> {
  const sites = await listSites()
  if (sites.length === 0) {
    process.stdout.write('No sites found.\n')
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
