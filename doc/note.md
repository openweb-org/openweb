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

TBD