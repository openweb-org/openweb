# OpenWeb v2: Website-to-API Compiler — 三层架构

> **状态**: COMPLETE
> **取代**: v1 (archived in `archive/v1/`)

## 从 v1 到 v2 的变化

v1 基于 HAR 的 compiler 加内置 navigation agent，有三种 execution mode。两个关键洞察催生了 v2：

1. 分析 100+ OpenTabs plugins 发现 **12 个 design gaps** — 纯 HAR capture 根本不够用于现代 SPA。
2. **用户的 agent 就是 browser-use agent** — 不需要单独的 navigation agent。Claude Code 通过 Playwright CLI 驱动浏览器，OpenWeb 在旁边 capture/compile。一个 CDP 连接，零冲突。

**v2 核心变化：**
- 三层架构（L1 structural + L2 primitives + L3 code escape hatch）
- 去掉内置 navigation agent — 浏览交给 Playwright CLI
- Multi-source capture（不只是 HAR）：HTTP, WebSocket, browser state, DOM
- AsyncAPI 3.x 描述 WebSocket/SSE protocol
- 双层 Playwright：agent 用 CLI，OpenWeb compiler 用 SDK（共享 CDP）

## 设计原则

**结构是默认，代码是例外。**

## 三层架构

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Structural Spec (declarative)          │
│  标准 OpenAPI 3.1 endpoints                       │
│  覆盖: ~40% 网站 (简单 REST/GraphQL)              │
├─────────────────────────────────────────────────┤
│  Layer 2: Interaction Primitives (pattern DSL)    │
│  参数化 patterns: auth, CSRF, signing             │
│  覆盖: ~50% 网站 (auth + CSRF + pagination)       │
├─────────────────────────────────────────────────┤
│  Layer 3: Code Adapters (escape hatch)           │
│  浏览器页面上下文中的任意 JS                        │
│  覆盖: ~10% 网站 (WhatsApp, Telegram 等)          │
└─────────────────────────────────────────────────┘
```

## 关键架构决策

### D1: Agent 就是 browser-use agent
不需要单独的 navigation agent。用户的 agent（Claude Code 等）通过 Playwright CLI 驱动浏览器。OpenWeb 不和 Playwright 争 scope — 只在其上添加 compilation 和 tool execution。

### D2: Multi-source capture（不只是 HAR）
| 数据 | 来源 | Playwright CLI 命令 |
|---|---|---|
| HTTP requests/responses | HAR | `playwright-cli network` |
| WebSocket frames | CDP events | `playwright-cli run-code` |
| localStorage | Browser storage | `playwright-cli localstorage-list` |
| sessionStorage | Browser storage | `playwright-cli sessionstorage-list` |
| cookies | Browser cookies | `playwright-cli cookie-list` |
| window globals | JS evaluation | `playwright-cli eval` |

### D3: Non-HTTP protocol — AsyncAPI 3.x
WebSocket/SSE 用 AsyncAPI 3.x 描述（和 OpenAPI 3.1 互补，共享 JSON Schema）。
Capture 格式：JSONL frame-level 录制。

## 文档地图

| 文档 | 状态 | 描述 |
|---|---|---|
| [browser-integration.md](../browser-integration.md) | COMPLETE | Playwright CLI 集成与 capture 架构 |
| [layer2-interaction-primitives.md](../layer2-interaction-primitives.md) | COMPLETE | Pattern DSL: auth/CSRF/signing/pagination |
| [layer3-code-adapters.md](../layer3-code-adapters.md) | COMPLETE | Code escape hatch 规范 |
| [pattern-library.md](../pattern-library.md) | COMPLETE | 所有已知 patterns 的目录 |
| [compiler-pipeline.md](../compiler-pipeline.md) | COMPLETE | 四阶段 Pipeline（capture -> analyze -> match -> emit） |
| [runtime-executor.md](../runtime-executor.md) | COMPLETE | Runtime（L1+L2+L3 execution + mode escalation） |
| [skill-package-format.md](../skill-package-format.md) | COMPLETE | Package 格式（manifest + OpenAPI + adapters） |
| [gap-coverage-matrix.md](../gap-coverage-matrix.md) | COMPLETE | 12 个 design gaps 到 layer/primitive 的映射 |
| [security-taxonomy.md](../security-taxonomy.md) | COMPLETE | Probing protocol + risk classification |
| [self-evolution.md](../self-evolution.md) | COMPLETE | Knowledge base 增长机制 |

### 中文概要文档

以下是核心设计文档的中文概要（解释性文字用中文，技术术语保持英文原文）：

| 文档 | 描述 |
|---|---|
| [cn/layer2-interaction-primitives.md](layer2-interaction-primitives.md) | L2 Pattern DSL: 27 种 auth/CSRF/signing/pagination/extraction primitives |
| [cn/pattern-library.md](pattern-library.md) | 103 个 OpenTabs plugins 的 L1/L2/L3 分类与统计 |
| [cn/compiler-pipeline.md](compiler-pipeline.md) | 四阶段 compiler pipeline: Capture -> Analyze -> Pattern Match -> Emit |
| [cn/browser-integration.md](browser-integration.md) | 浏览器集成: CDP connection, multi-source capture, tool execution |

## 12 个 Design Gaps 覆盖情况

| # | Gap | Layer | Primitives | 状态 |
|---|---|---|---|---|
| 001 | 纯 SSR / 无 client API | L2 | `html_selector`, `ssr_next_data`, `script_json` | COMPLETE |
| 002 | Browser state extraction | L2 | `localStorage_jwt`, `sessionStorage_msal`, `page_global` | COMPLETE |
| 003 | WebSocket protocols | L2/L3 | `websocket_intercept` + AsyncAPI 3.x | COMPLETE |
| 004 | 动态 request signing | L2/L3 | `sapisidhash`, `aws_sigv4`; L3 处理混淆签名 | COMPLETE |
| 005 | CSRF token rotation | L2 | `cookie_to_header`, `meta_tag`, `page_global` | COMPLETE |
| 006 | DOM parsing / SSR cache | L2 | `ssr_next_data`, `apollo_cache`, `script_json` | COMPLETE |
| 007 | 无 HTTP API | L3 | Code adapter (WhatsApp, Telegram) | COMPLETE |
| 008 | 多步 auth exchange | L2 | `lazy_fetch`, `exchange_chain` | COMPLETE |
| 009 | Persisted query hashes | L2/L3 | L3 提取 webpack hash | COMPLETE |
| 010 | Google gapi proxy | L2 | `gapi_proxy` | COMPLETE |
| 011 | Page navigation / DOM | L3 | Code adapter (UI automation) | COMPLETE |
| 012 | Cross-origin bearer | L2 | `sessionStorage_token`, multi-server config | COMPLETE |
