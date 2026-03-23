/**
 * Record terraform-cloud traffic via managed Chrome CDP.
 * Auto-generated — do not edit manually.
 */
process.env.RECORD_SITE = 'terraform-cloud'
process.env.RECORD_DOMAIN = 'terraform.io'
process.env.RECORD_PAGES = '["https://app.terraform.io/app"]'
await import('./record-cdp.ts')
