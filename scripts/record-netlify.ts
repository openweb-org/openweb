/**
 * Record netlify traffic via managed Chrome CDP.
 * Auto-generated — do not edit manually.
 */
process.env.RECORD_SITE = 'netlify'
process.env.RECORD_DOMAIN = 'netlify.com'
process.env.RECORD_PAGES = '["https://app.netlify.com/"]'
await import('./record-cdp.ts')
