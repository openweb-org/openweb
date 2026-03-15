# Browser Integration & Capture Architecture (中文概要)

> **状态**: COMPLETE
> **覆盖 Gaps**: 002, 003, 006, 011
> **核心原则**: OpenWeb 不拥有浏览器。

## 核心架构

用户的 agent (Claude Code, Cursor 等) 通过 Playwright CLI 驱动浏览器。OpenWeb 通过 CDP 并行连接，用于 capture 和 tool execution。一个 Chrome 实例，两个消费者，零冲突。

```
Chrome (--remote-debugging-port=9222)
  |
  ├── Playwright CLI ---- agent 驱动浏览
  |     goto, click, fill, eval, screenshot
  |
  └── OpenWeb SDK ------- compiler captures + executor runs tools
        connectOverCDP(), HAR recording, CDP listeners, page.evaluate()
```

### 职责分离

| Playwright CLI (agent) | OpenWeb (compiler + executor) |
|---|---|
| Navigate (goto, click, fill) | Capture traffic + state |
| Screenshots / a11y tree | Pattern detection |
| Storage access (read/write) | Spec generation (L1 + L2 + L3) |
| JS execution (eval) | Tool execution (L2/L3 primitives) |
| Session management | Self-healing (fingerprint drift) |

### 为什么是双层 Playwright

**Agent 用 CLI** -- 为 LLM agent 设计的 token-efficient 命令。一个 `goto` + `snapshot` 约 100 tokens，而加载完整 Playwright SDK tool schema 需约 5000 tokens。

**OpenWeb 用 SDK** -- 需要 programmatic CDP session management、`recordHar` API、WebSocket frames 的结构化 event handling、以及 `page.evaluate()` 执行 L2/L3 primitives。Compiler 是一个 Node.js 进程，不是 LLM agent。

---

## CDP Connection Model

### 连接 Agent 的浏览器

```typescript
import { chromium } from 'playwright';

// Agent 的浏览器已开启 remote debugging
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0]; // agent 的 browsing context
const page = context.pages()[0];       // 当前页面
```

**CLI 启动**（由 agent 或用户执行）:
```bash
# Agent 通常用 remote debugging 启动 Chrome:
playwright-cli --cdpEndpoint=http://localhost:9222 goto "https://example.com"

# OpenWeb 连接:
openweb capture start --cdp-endpoint http://localhost:9222
```

### Session Isolation

Playwright CLI 支持 named sessions (`-s=session-name`)。OpenWeb **不**创建自己的 session -- 它连接 agent 已有的 context。如果 agent 使用多个 sessions，OpenWeb 可指定目标：

```bash
openweb capture start --cdp-endpoint http://localhost:9222 --session default
```

### Connection Lifecycle

```
1. Agent 启动浏览器（或 OpenWeb 检测到运行中的实例）
2. OpenWeb 通过 connectOverCDP() 连接
3. OpenWeb 附加 listeners (network, WebSocket, navigation)
4. Agent 浏览 -- OpenWeb passive 录制
5. Agent 发出 "done browsing" 信号（或超时）
6. OpenWeb 断开连接，写入 capture bundle
```

OpenWeb 在 capture 期间**永远不**导航、点击或修改页面状态。它是一个 **passive observer**（除了 `page.evaluate()` 读取 globals/DOM，这是只读操作）。

---

## Multi-Source Capture

### 1. HTTP Traffic (HAR)

标准 HAR via Playwright 的 recording API：

```typescript
// 启动 HAR 录制
await context.routeFromHAR('capture/traffic.har', { update: true });

// 或通过 event listeners 手动 capture（更精细控制）:
page.on('request', (req) => {
  harEntries.push({
    startedDateTime: new Date().toISOString(),
    request: {
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      postData: req.postData(),
    },
  });
});

page.on('response', async (res) => {
  const entry = findEntry(res.request());
  entry.response = {
    status: res.status(),
    headers: res.headers(),
    content: await res.body().catch(() => null),
  };
});
```

**Traffic filtering**（在 capture 期间应用，非事后处理）：

```typescript
const BLOCKED_DOMAINS = new Set([
  'google-analytics.com', 'googletagmanager.com', 'segment.io',
  'mixpanel.com', 'amplitude.com', 'hotjar.com', 'sentry.io',
  'doubleclick.net', 'facebook.net', 'criteo.com', 'datadog-agent',
  // ~40 个 analytics/tracking 域名
]);

const API_CONTENT_TYPES = new Set([
  'application/json', 'application/vnd.api+json', 'text/json',
  'application/x-www-form-urlencoded', 'application/graphql+json',
  'application/graphql-response+json',
]);

function shouldCapture(url: URL, contentType: string | null): boolean {
  if (BLOCKED_DOMAINS.has(url.hostname)) return false;
  if (contentType && !API_CONTENT_TYPES.has(contentType.split(';')[0])) return false;
  if (url.pathname.match(/\.(js|css|png|jpg|gif|svg|woff2?|ttf)$/)) return false;
  return true;
}
```

### 2. WebSocket Frames (JSONL)

通过 CDP `Network.webSocketFrame*` events 捕获：

```typescript
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');

const wsLog: WsFrame[] = [];

cdp.on('Network.webSocketCreated', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'open',
    url: e.url,
  });
});

cdp.on('Network.webSocketFrameSent', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'frame',
    direction: 'sent',
    opcode: e.response.opcode,
    payload: e.response.payloadData,
  });
});

cdp.on('Network.webSocketFrameReceived', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'frame',
    direction: 'received',
    opcode: e.response.opcode,
    payload: e.response.payloadData,
  });
});

cdp.on('Network.webSocketClosed', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'close',
  });
});
```

**JSONL 输出格式** (`websocket_frames.jsonl`):
```jsonl
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00.000Z","type":"open","url":"wss://gateway.discord.gg/?v=10"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00.100Z","type":"frame","direction":"sent","opcode":1,"payload":"{\"op\":2,\"d\":{\"token\":\"...\",\"intents\":32767}}"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00.200Z","type":"frame","direction":"received","opcode":1,"payload":"{\"t\":\"READY\",\"op\":0,\"d\":{\"guilds\":[...]}}"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:05:00.000Z","type":"close","code":1000}
```

**TypeScript type**:
```typescript
type WsFrame =
  | { connectionId: string; timestamp: string; type: 'open'; url: string }
  | { connectionId: string; timestamp: string; type: 'frame';
      direction: 'sent' | 'received'; opcode: number; payload: string }
  | { connectionId: string; timestamp: string; type: 'close'; code?: number };
```

**应用场景**: Discord, ClickUp, Slack 使用 WebSocket 进行实时功能。ClickUp 通过 WebSocket 发送 auth tokens (Gap 003)。捕获 frames 使 compiler 能检测 `websocket_intercept` auth patterns。

### 3. Browser State Snapshots

在 capture 开始和每次 page navigation 后抓取：

```typescript
async function captureStateSnapshot(
  page: Page,
  context: BrowserContext,
  trigger: string,
): Promise<StateSnapshot> {
  return {
    timestamp: new Date().toISOString(),
    trigger, // 'initial' | 'navigation' | 'manual'
    url: page.url(),
    localStorage: await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        data[key] = localStorage.getItem(key)!;
      }
      return data;
    }),
    sessionStorage: await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!;
        data[key] = sessionStorage.getItem(key)!;
      }
      return data;
    }),
    cookies: await context.cookies(),
  };
}
```

**Navigation 检测** -- URL 变化时自动抓取 snapshot:
```typescript
page.on('framenavigated', async (frame) => {
  if (frame === page.mainFrame()) {
    await page.waitForLoadState('domcontentloaded');
    const snapshot = await captureStateSnapshot(page, context, 'navigation');
    snapshots.push(snapshot);
  }
});
```

**TypeScript type**:
```typescript
interface StateSnapshot {
  timestamp: string;
  trigger: 'initial' | 'navigation' | 'manual';
  url: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
    expires: number;
  }>;
}
```

**应用场景**: 60+ plugins 从 browser storage 提取 auth tokens (Gap 002)。Snapshots 使 compiler 能将 `localStorage['BSKY_STORAGE']` 与 `Authorization: Bearer xxx` 进行 correlation。

### 4. DOM & Globals Extraction

每次 navigation 后抓取（与 state snapshots 同步）：

```typescript
async function captureDomAndGlobals(page: Page): Promise<DomExtraction> {
  return page.evaluate(() => {
    const metaTags = Array.from(document.querySelectorAll('meta[name]')).map(m => ({
      name: m.getAttribute('name')!,
      content: m.getAttribute('content') ?? '',
    }));

    const scriptJsonTags = Array.from(
      document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]'),
    ).map(s => ({
      id: s.id || null,
      type: s.getAttribute('type'),
      dataTarget: s.getAttribute('data-target') || null,
      size: (s.textContent ?? '').length,
    }));

    const hiddenInputs = Array.from(
      document.querySelectorAll('input[type="hidden"]'),
    ).map(i => ({
      name: i.getAttribute('name'),
      formAction: i.closest('form')?.getAttribute('action') ?? null,
    }));

    const KNOWN_GLOBALS = [
      '__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__',
      '__APOLLO_STATE__', '__APOLLO_CLIENT__',
      '__PRELOADED_STATE__', '__UNIVERSAL_DATA_FOR_REHYDRATION__',
      'ytcfg', '__context__', '__initialData', 'PRELOADED',
      'netflix', 'StackExchange', 'initData', 'bootstrap',
      'POSTHOG_APP_CONTEXT', '__nr', 'gon', 'WIZ_global_data',
      'webpackChunkdiscord_app', 'webpackChunk_N_E',
    ];

    const globals: Record<string, string> = {};
    for (const key of KNOWN_GLOBALS) {
      try {
        const val = (window as any)[key];
        if (val !== undefined) {
          globals[key] = typeof val === 'object' ? 'object' : typeof val;
        }
      } catch {}
    }

    const webpackChunks = Object.keys(window)
      .filter(k => k.startsWith('webpackChunk'));
    const gapiAvailable = typeof (window as any).gapi?.client?.request === 'function';

    return { metaTags, scriptJsonTags, hiddenInputs, globals, webpackChunks, gapiAvailable };
  });
}
```

**TypeScript type**:
```typescript
interface DomExtraction {
  metaTags: Array<{ name: string; content: string }>;
  scriptJsonTags: Array<{
    id: string | null;
    type: string | null;
    dataTarget: string | null;
    size: number;
  }>;
  hiddenInputs: Array<{ name: string | null; formAction: string | null }>;
  globals: Record<string, string>; // key -> typeof value
  webpackChunks: string[];
  gapiAvailable: boolean;
}
```

**应用场景**: Globals 检测直接输入 Phase 3 pattern matching。`__NEXT_DATA__` -> `ssr_next_data` (Gap 006)。`gapi.client` -> `gapi_proxy` (Gap 010)。`webpackChunk*` -> `webpack_module_walk` (Gap 002)。Meta CSRF tags -> `meta_tag` (Gap 005)。

---

## Capture Bundle

所有 capture 输出写入一个目录：

```
capture/
├── traffic.har                 # Filtered HTTP traffic
├── websocket_frames.jsonl      # WebSocket frame log (如有 WS 连接)
├── state_snapshots/
│   ├── 001_initial.json        # StateSnapshot
│   ├── 002_after_login.json
│   └── 003_after_search.json
├── dom_extractions/
│   ├── 001_initial.json        # DomExtraction
│   └── 002_after_login.json
└── metadata.json               # CaptureMetadata
```

**Metadata**:
```typescript
interface CaptureMetadata {
  siteUrl: string;
  startTime: string;
  endTime: string;
  pageCount: number;      // 观察到的 navigation 次数
  requestCount: number;   // 捕获的 HTTP 请求数（filtering 后）
  wsConnectionCount: number;
  snapshotCount: number;
  captureVersion: string; // 产生此 bundle 的 openweb 版本
}
```

---

## Tool Execution (Runtime)

当 runtime executor 需要浏览器上下文来执行 L2/L3 primitives 时，它连接同一个 Chrome 实例：

```typescript
// Runtime 连接 agent 的浏览器
const browser = await chromium.connectOverCDP(cdpEndpoint);
const page = browser.contexts()[0].pages()[0];

// 执行 L2 primitive -- 例如提取 localStorage JWT
const token = await page.evaluate((config) => {
  const raw = localStorage.getItem(config.key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return config.path.split('.').reduce((obj, key) => obj?.[key], parsed);
}, { key: 'BSKY_STORAGE', path: 'session.currentAccount.accessJwt' });

// 用 token 发起 HTTP 请求
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});
```

对于 `mode: browser_fetch`，整个请求在 page context 中执行：

```typescript
const result = await page.evaluate(async (params) => {
  const res = await fetch(params.url, {
    method: params.method,
    headers: params.headers,
    body: params.body,
    credentials: 'include',
  });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers),
    body: await res.text(),
  };
}, requestParams);
```

对于 L3 code adapters，adapter 的 `execute()` 函数直接接收 `page` 对象。

---

## Non-HTTP Protocol 支持

### AsyncAPI 3.x 用于 WebSocket/SSE (L1)

结构化 message schemas 的 WebSocket APIs 通过 AsyncAPI 3.x 描述。覆盖消息模式可预测的网站：Discord (gateway opcodes), ClickUp (real-time updates), Slack (RTM events)。

```yaml
# asyncapi.yaml (Discord gateway)
asyncapi: 3.0.0
info:
  title: Discord Gateway
  version: "10"
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
    messages:
      identify:
        name: identify
        payload:
          type: object
          properties:
            op: { type: integer, const: 2 }
            d:
              type: object
              properties:
                token: { type: string }
                intents: { type: integer }
      dispatch:
        name: dispatch
        payload:
          type: object
          properties:
            op: { type: integer, const: 0 }
            t: { type: string }
            d: { type: object }
      heartbeat:
        name: heartbeat
        payload:
          type: object
          properties:
            op: { type: integer, const: 1 }
            d: { type: integer, nullable: true }
```

WebSocket 过于复杂而无法结构化描述的网站 (WhatsApp, Telegram) 落入 L3 code adapters。

### SSE (Server-Sent Events)

作为 `Content-Type: text/event-stream` 的 HTTP response 捕获。HAR 捕获初始请求；单独的 events 记录在 JSONL 文件中，格式与 WebSocket frames 相同：

```jsonl
{"connectionId":"sse1","timestamp":"...","type":"open","url":"https://api.example.com/events"}
{"connectionId":"sse1","timestamp":"...","type":"frame","direction":"received","payload":"data: {\"type\":\"update\"}"}
```

---

## Error Handling

### CDP Connection Failures

```typescript
async function connectWithRetry(cdpEndpoint: string, maxRetries = 3): Promise<Browser> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chromium.connectOverCDP(cdpEndpoint, { timeout: 30_000 });
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}
```

### Page Navigation 期间的 Capture

当 agent 导航到新页面时，OpenWeb 必须重新附加 listeners：

```typescript
context.on('page', async (newPage) => {
  attachListeners(newPage); // 重新附加 request/response/WS listeners
  await captureStateSnapshot(newPage, context, 'navigation');
  await captureDomAndGlobals(newPage);
});
```

### Stale Page Context

如果在 OpenWeb 执行 JS 时页面导航或 reload，`page.evaluate()` 调用会抛出 `TargetClosedError`。Executor 应 catch 并在 `waitForLoadState('domcontentloaded')` 后 retry。

---

## Playwright CLI 命令参考

Agent 使用的命令（OpenWeb **不**调用这些 -- 它使用 SDK 等价物）：

| 命令 | 用途 | OpenWeb 等价操作 |
|---|---|---|
| `goto <url>` | 导航 | (仅 agent 使用) |
| `click <selector>` | 交互 | (仅 agent 使用) |
| `eval <expr>` | 执行 JS | `page.evaluate()` |
| `localstorage-list` | 读取 localStorage | `page.evaluate(() => ({...localStorage}))` |
| `sessionstorage-list` | 读取 sessionStorage | `page.evaluate(() => ({...sessionStorage}))` |
| `cookie-list` | 读取 cookies | `context.cookies()` |
| `network` | 列出 HTTP 请求 | HAR recording 或 `page.on('request')` |
| `run-code <code>` | 执行 Playwright script | 直接 SDK 调用 |
| `tracing-start/stop` | 录制 traces | `context.tracing.start/stop()` |
| `state-save/load` | 导出/导入 state | `context.storageState()` |
| `snapshot` | 页面状态快照 | `page.evaluate()` + custom extraction |

---

## 交叉引用

- **Capture pipeline** -> [compiler-pipeline.md](../compiler-pipeline.md): Phase 1 使用此 capture 架构
- **L2 primitives** -> [layer2-interaction-primitives.md](../layer2-interaction-primitives.md): Runtime execution 使用 `page.evaluate()`
- **L3 adapters** -> [layer3-code-adapters.md](../layer3-code-adapters.md): Adapters 接收 `page` 对象
- **Runtime** -> [runtime-executor.md](../runtime-executor.md): Executor 通过 CDP 连接执行 L2/L3
- **Package format** -> [skill-package-format.md](../skill-package-format.md): AsyncAPI 在 package 中的位置
