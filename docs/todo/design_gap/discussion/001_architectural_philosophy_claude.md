# Discussion: OpenTabs vs ApiTap vs OpenWeb — Architectural Philosophy

## Three Philosophies

```
ApiTap / OpenWeb:  Website → Structural Spec → Generic Executor
OpenTabs:          Website → Code Plugin → Browser Execution
```

**ApiTap/OpenWeb produce specs** (declarative descriptions):
- ApiTap: `skill.json` — endpoint list + params + auth config
- OpenWeb: `openapi.yaml` — OpenAPI 3.1 standard

**OpenTabs produces code** (imperative logic):
- Each plugin is TypeScript running inside the browser page
- No intermediate representation, no "website API description file"
- Build-time `tools.json` only describes MCP tool interface (input/output schema),
  NOT the underlying HTTP endpoints

## OpenTabs Plugin Consistency

Despite no cross-site structural spec, plugins share consistent code patterns:

### Uniform Layer Architecture

```
src/
  index.ts          ← Plugin class (extends OpenTabsPlugin)
  <site>-api.ts     ← API layer (HTTP calls + auth)
  tools/
    schemas.ts      ← Zod schemas (input/output types)
    <tool>.ts       ← One file per tool (defineTool)
```

### Uniform Interface Contract

```typescript
class XxxPlugin extends OpenTabsPlugin {
  name: string;
  urlPatterns: string[];
  tools: ToolDefinition[];
  isReady(): Promise<boolean>;
  isAuthenticated?(): boolean;
}

defineTool({
  name: string,
  input: z.object({...}),
  output: z.object({...}),
  handle: async (params) => {...},
})
```

### Uniform SDK Toolkit

```typescript
fetchFromPage(url, init)       // fetch with credentials
getLocalStorage(key)           // read localStorage
getPageGlobal('path.to.val')   // read window globals
getCookie(name)                // read cookie
getAuthCache<T>(ns)            // persistent auth cache
waitUntil(predicate, opts)     // poll condition
waitForSelector(sel, opts)     // wait for DOM element
ToolError.auth / .notFound     // standard error classes
```

### But Consistency Stops at the Interface

Each plugin's `*-api.ts` is completely different:

| Plugin | API Layer Logic |
|---|---|
| Discord | `fetch('/api/v9/...')` REST calls |
| GitHub | webpack bundle regex → GraphQL persisted query |
| WhatsApp | `require('WAWebChatCollection')` internal modules |
| HN | `fetchText('/news')` → DOMParser HTML parsing |
| AWS | `Response.prototype.json` patch → SigV4 signing |
| Google Calendar | `gapi.client.request()` proxy |
| OnlyFans | webpack module 977434 function JA crypto signing |

No cross-site structural abstraction. Each site's auth, request construction,
and response parsing is custom code.

## The Key Insight

OpenTabs' philosophy: **Don't try to abstract websites. Embrace each site's
uniqueness. Use code's full expressive power to adapt.** Browser is the universal
executor, code is the universal adapter.

This explains why OpenTabs solves all 12 design gaps — it doesn't HAVE gaps,
because it doesn't try to fit websites into a structural framework. Every weird
pattern gets custom code.

**The cost**: Every new site needs a new plugin. No generalization, no reuse
(beyond SDK toolkit).
