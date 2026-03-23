import { readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'

const inputPath = process.argv[2]
const outputPath = process.argv[3] || inputPath

const doc = parse(readFileSync(inputPath, 'utf8'))

// Paths to KEEP — core Stripe API operations
const keepPaths = new Set([
  '/v1/account',
  '/v1/account/persons',
  '/v1/balance/pending/usd',
  '/v1/billing/meters',
  '/v1/customers',
  '/v1/events',
  '/v1/invoices',
  '/v1/payment_links',
  '/v1/payouts',
  '/v1/prices',
  '/v1/products',
  '/v1/subscriptions',
  // Useful dashboard-level reads
  '/ajax/balance/summary',
  '/ajax/charts/gross_volume',
  '/ajax/charts/net_volume',
  '/ajax/charts/new_customer_count',
  '/ajax/payment_intents_with_legacy_charges',
  '/ajax/external_accounts',
  '/ajax/external_accounts/bank_accounts',
])

// Also keep the unified_customers_list
keepPaths.add('/v1/unified_customers_list')

const filteredPaths = {}
for (const [path, ops] of Object.entries(doc.paths)) {
  if (keepPaths.has(path)) {
    filteredPaths[path] = ops
  }
}

// Rename operations for clarity
const renames = {
  'list_ajax_payment_intents_with_legacy_charges': 'listPaymentIntents',
  'list_customers': 'listCustomers',
  'list_events': 'listEvents',
  'list_invoices': 'listInvoices',
  'list_products': 'listProducts',
  'list_prices': 'listPrices',
  'list_subscriptions': 'listSubscriptions',
  'list_payouts': 'listPayouts',
  'list_payment_links': 'listPaymentLinks',
  'list_billing_meters': 'listBillingMeters',
  'list_account_persons': 'listAccountPersons',
  'get_account': 'getAccount',
  'get_balance_pending_usd': 'getBalancePending',
  'get_ajax_balance_summary': 'getBalanceSummary',
  'get_ajax_charts_gross_volume': 'getGrossVolumeChart',
  'get_ajax_charts_net_volume': 'getNetVolumeChart',
  'get_ajax_charts_new_customer_count': 'getNewCustomerChart',
  'list_ajax_external_accounts': 'listExternalAccounts',
  'list_ajax_external_accounts_bank_accounts': 'listBankAccounts',
  'get_unified_customers_list': 'getUnifiedCustomersList',
}

for (const [, ops] of Object.entries(filteredPaths)) {
  for (const [, op] of Object.entries(ops)) {
    if (op?.operationId && renames[op.operationId]) {
      op.operationId = renames[op.operationId]
      // Update summary too
      op.summary = op.operationId.replace(/([A-Z])/g, ' $1').trim()
    }
  }
}

doc.paths = filteredPaths
doc.info.title = 'stripe-fixture'

writeFileSync(outputPath, stringify(doc, { lineWidth: 120 }))
console.log(`Curated: ${Object.keys(filteredPaths).length} paths (from original)`)
