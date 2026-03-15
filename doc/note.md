我在想我执行的roadmap，和最终artifacts:

## Artifacts

1. **Meta-spec** — x-openweb schema 定义
   - L2 primitive type catalog (27 types: auth/csrf/signing/pagination/extraction)
   - L3 CodeAdapter interface
   - Skill package format (manifest.json schema, x-openweb extension schema)
   - Formalized as JSON Schema + TypeScript types
   - 初始来源为现在 `doc/todo/v2/` 的设计文档为基础，implement过程中不断修改，验证后 formalize

2. **Runtime** — 读 instance spec，执行 L2/L3，做请求
   - CLI progressive navigation:
     - `openweb sites` — 列出所有已编译网站
     - `openweb <site>` — 列出该网站的 operations
     - `openweb <site> <op>` — 显示参数 + 返回值
     - `openweb <site> exec <op> '{...}'` — 执行
   - Browser integration: CDP connection, `page.evaluate()` for L2/L3 execution
   - Mode escalation: direct_http → session_http → browser_fetch
   - Session management, token cache, rate limiting, SSRF protection

3. **Compiler** — 观察网站行为，生成 instance spec
   - artifacts: cli + companion self-contained pipeline SOP .md file
   - Phase 1: Multi-source capture (HAR + WebSocket JSONL + state + DOM)
   - Phase 2: Clustering + parameter differentiation + schema induction
   - Phase 3: Classify ────── detect L2 primitives, probe mode, assign risk tier
   - Phase 4: Emit skill package (openapi.yaml + asyncapi.yaml + adapter stubs)
   - CLI: `openweb capture/compile`
   - Self-heal: fingerprint drift detection → re-probe → flag recompilation

4. **Skill packages** — 每个网站的 instance spec + L3 code
   - openapi.yaml (L1 endpoints + L2 x-openweb primitives)
   - asyncapi.yaml (WebSocket/SSE, optional)
   - adapters/*.ts (L3 code, optional)
   - manifest.json + tests/
   - Compiler 输出，也可手写/手调
   - 先编译 5-10 个代表性网站验证 meta-spec + runtime + compiler

5. **Agent skill** — CLI 的薄 wrapper
   - 给 Claude/Codex/OpenClaw 等 agent 用
   - 最后做，依赖 runtime 和 compiler 稳定
   - 打包给end-users使用

## Roadmap

核心策略：**纵向打通再横向扩展**。先让一个 L2 网站 end-to-end 跑通（capture → classify → emit → exec），
再扩展到更多网站和更多 primitive types。每个 milestone 产出可验证的 artifact。

### M0: Browser Capture 基础

让 Playwright 真正 capture 一个网站的 traffic + state + DOM。

- 安装 Playwright，实现 `connectOverCDP()` 连接
- 实现四个 capture source（HAR, WebSocket JSONL, state snapshots, DOM/globals extraction）
- 用一个真实网站（如 Instagram）验证 capture bundle 完整性
- 输出：`openweb capture start/stop` 生成 capture bundle

**依赖**：无（现有 src/ 已有 CLI 骨架）
**验证**：capture bundle 包含 traffic.har + state_snapshots/ + dom_extractions/

### M1: Meta-spec 形式化

把 `doc/todo/v2/` 设计文档转化为可执行的 TypeScript types + JSON Schema。

- 从 `layer2-interaction-primitives.md` 的 TypeScript 定义提取为 `src/types/`
- `AuthPrimitive`, `CsrfPrimitive`, `SigningPrimitive`, `PaginationPrimitive`, `ExtractionPrimitive`
- `CodeAdapter` interface, `XOpenWebServer`, `XOpenWebOperation`
- `manifest.json` JSON Schema
- x-openweb extension validation (AJV)

**依赖**：无（纯 type 定义）
**验证**：现有 Open-Meteo fixture + 手写的 Instagram fixture 通过 schema validation

### M2: 第一个 L2 网站 end-to-end

挑 Instagram（`cookie_session` + `cookie_to_header` CSRF）— 最简单的 L2 组合。

- **Compiler Phase 3**：实现 Classify step — 从 capture correlations 检测 `cookie_session` + `cookie_to_header`
- **Compiler Phase 4**：emit `openapi.yaml` with `x-openweb` auth + csrf config
- **Runtime**：实现 `session_http` mode — 从 browser 提取 cookies + CSRF token，用 HTTP client 发请求
- **Runtime**：实现 `cookie_session` + `cookie_to_header` L2 handlers
- 输出：`openweb compile instagram` 生成 skill package → `openweb exec instagram getTimeline` 返回真实数据

**依赖**：M0 (capture), M1 (types)
**验证**：Instagram getTimeline + likeMedia 都能跑通
**里程碑意义**：首次证明 L2 primitive model 在真实网站上 work

### M3: L2 广度 — 5 个多样化网站

覆盖主要 L2 primitive categories：

| 网站 | Auth | CSRF | Signing | Extraction | 验证的 primitive |
|---|---|---|---|---|---|
| Bluesky | localStorage_jwt | — | — | — | localStorage 提取 |
| YouTube | page_global | — | sapisidhash | — | page global + 已知签名算法 |
| GitHub | cookie_session | meta_tag | — | script_json | meta tag CSRF + SSR extraction |
| Sentry | page_global | cookie_to_header | — | — | link_header pagination |
| Reddit | exchange_chain | api_response | — | — | 多步 auth + API-based CSRF |

- 实现缺失的 L2 handlers（`localStorage_jwt`, `page_global`, `sapisidhash`, `meta_tag`, `exchange_chain`, `api_response`, `link_header`, `script_json`）
- 每个网站：capture → compile → exec 全链路
- 输出：5 个 skill packages

**依赖**：M2 (session_http + 基础 L2 framework)
**验证**：5 个网站各 2-3 个 operations 跑通
**里程碑意义**：证明 L2 primitives 覆盖主流网站（这 5 个覆盖了 9/27 primitive types）

### M4: L3 + browser_fetch

- 实现 `browser_fetch` mode（`page.evaluate(fetch(...))`)
- 实现 L3 `CodeAdapter` execution framework
- Discord（`webpack_module_walk` auth）— 验证 browser_fetch + L2 复杂 auth
- 1 个纯 L3 网站（WhatsApp 或 Telegram）— 验证 adapter interface
- 输出：2 个 L3 skill packages + adapter 代码

**依赖**：M3 (L2 framework stable)
**验证**：Discord getMessages + WhatsApp getChats 跑通
**里程碑意义**：三层架构完整验证（L1 + L2 + L3 全部可运行）

### M5: Agent Skill + 收尾

- CLI wrapper 给 Claude Code / Codex 用（SKILL.md + tool definitions）
- Self-healing：fingerprint comparison → mode re-probe → flag recompilation
- 补全剩余 L2 handlers（从 27 types 中补齐高频但 M3 未覆盖的）
- 扩展到 10+ 网站
- 输出：可分发的 agent skill package

**依赖**：M4 (三层全通)
**验证**：Claude Code 能通过 skill 调用 openweb exec 完成真实任务