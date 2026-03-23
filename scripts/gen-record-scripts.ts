/**
 * Generate per-site recording scripts from a config.
 * Creates scripts/record-<site>.ts for each site that wraps record-cdp.ts.
 */
import { writeFileSync } from 'node:fs'

interface SiteConfig {
  name: string
  domain: string
  pages: string[]
}

const sites: SiteConfig[] = [
  {
    name: 'todoist',
    domain: 'todoist.com',
    pages: [
      'https://app.todoist.com/app/today',
      'https://app.todoist.com/app/inbox',
      'https://app.todoist.com/app/upcoming',
      'https://app.todoist.com/app/filters-labels',
    ],
  },
  {
    name: 'sentry',
    domain: 'sentry.io',
    pages: [
      'https://sentry.io/organizations/',
    ],
  },
  {
    name: 'netlify',
    domain: 'netlify.com',
    pages: [
      'https://app.netlify.com/',
    ],
  },
  {
    name: 'vercel',
    domain: 'vercel.com',
    pages: [
      'https://vercel.com/dashboard',
    ],
  },
  {
    name: 'supabase',
    domain: 'supabase.com',
    pages: [
      'https://supabase.com/dashboard/projects',
    ],
  },
  {
    name: 'shortcut',
    domain: 'shortcut.com',
    pages: [
      'https://app.shortcut.com/',
    ],
  },
  {
    name: 'terraform-cloud',
    domain: 'terraform.io',
    pages: [
      'https://app.terraform.io/app',
    ],
  },
]

for (const site of sites) {
  const script = `/**
 * Record ${site.name} traffic via managed Chrome CDP.
 * Auto-generated — do not edit manually.
 */
process.env.RECORD_SITE = '${site.name}'
process.env.RECORD_DOMAIN = '${site.domain}'
process.env.RECORD_PAGES = '${JSON.stringify(site.pages)}'
await import('./record-cdp.ts')
`
  writeFileSync(`scripts/record-${site.name}.ts`, script)
  console.log(`Created scripts/record-${site.name}.ts`)
}
