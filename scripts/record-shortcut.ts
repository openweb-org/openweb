/**
 * Record shortcut traffic via managed Chrome CDP.
 * Auto-generated — do not edit manually.
 */
process.env.RECORD_SITE = 'shortcut'
process.env.RECORD_DOMAIN = 'shortcut.com'
process.env.RECORD_PAGES = '["https://app.shortcut.com/"]'
await import('./record-cdp.ts')
