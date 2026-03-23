/**
 * Record sentry traffic via managed Chrome CDP.
 * Auto-generated — do not edit manually.
 */
process.env.RECORD_SITE = 'sentry'
process.env.RECORD_DOMAIN = 'sentry.io'
process.env.RECORD_PAGES = '["https://sentry.io/organizations/"]'
await import('./record-cdp.ts')
