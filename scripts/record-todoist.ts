/**
 * Record todoist traffic via managed Chrome CDP.
 * Auto-generated — do not edit manually.
 */
process.env.RECORD_SITE = 'todoist'
process.env.RECORD_DOMAIN = 'todoist.com'
process.env.RECORD_PAGES = '["https://app.todoist.com/app/today","https://app.todoist.com/app/inbox","https://app.todoist.com/app/upcoming","https://app.todoist.com/app/filters-labels"]'
await import('./record-cdp.ts')
