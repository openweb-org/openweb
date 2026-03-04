import { listSites } from '../lib/openapi.js'

export async function sitesCommand(): Promise<void> {
  const sites = await listSites()
  if (sites.length === 0) {
    process.stdout.write('No sites found.\n')
    return
  }

  for (const site of sites) {
    process.stdout.write(`${site}\n`)
  }
}
