# Layer 3: Code Adapters — Escape Hatch

> **NEW in v2.** Arbitrary JS for sites that can't be expressed structurally.
> Runs in browser page context with full DOM/storage/module access.

## TODO

1. Define the adapter interface (input schema, output schema, JS code)
2. Define execution environment (browser page context, available APIs)
3. Define how L3 adapters can call L2 primitives
4. Show examples from OpenTabs for each L3-required site:
   - WhatsApp — internal module `require()` for messaging
   - Telegram — `rootScope.managers.apiManager.invokeApi()` for MTProto
   - OnlyFans — webpack signing function extraction
   - TikTok — `byted_acrawler.frontierSign()` for X-Bogus
5. Define package format for adapters (file location, naming, bundling)
6. Define security model (sandboxing, permission boundaries)
7. Define how the compiler decides L2 vs L3 for a given pattern
