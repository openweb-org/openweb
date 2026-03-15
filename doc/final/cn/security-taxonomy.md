# Security Taxonomy 概要

## 三层安全映射

OpenWeb v2 的安全机制与三层架构对齐：

| Layer | 覆盖内容 |
|-------|----------|
| L1 | 标准 HTTP auth — API key、Bearer token、OAuth 2.0 |
| L2 | Browser state + CSRF + signing — cookie auth、CSRF token rotation、SAPISIDHASH / SigV4 等声明式签名 |
| L3 | 混淆签名 + 内部 protocol — OnlyFans/TikTok 的自定义签名、WhatsApp/Telegram 的非 HTTP 通信 |

## Observation Paradox

录制（capture）阶段时一切请求都成功了，但无法确定哪些 header、cookie、签名是真正必须的。

例如：一个请求携带了 20 个 header，可能只有 3 个是服务端校验的。如果盲目重放所有 header，spec 会充满噪音。

**解决方案**：probing。在 compile 阶段逐步移除 header/cookie，观察哪些会导致 401/403，从而确定最小必要集。

## Escalation Ladder

确定一个 endpoint 所需的最低 execution mode：

```
direct_http → session_http → browser_fetch → human_handoff
```

- 从最轻量的 `direct_http` 开始尝试
- 收到 401/403 时逐级升级
- 整个过程最多 6 次请求（每级 1-2 次）
- 最终仍失败则标记为 `human_handoff`

### Write Endpoints 例外

write operations（POST/PUT/DELETE）跳过 probing，默认使用 `browser_fetch`。原因：

- write 请求可能产生副作用（发消息、下单、删除数据）
- probing 会实际执行这些操作
- 安全起见直接用最高权限模式

## Risk Classification

五级 risk tier，基于确定性规则（非 LLM 判断）：

| Tier | 判定规则 | Rate Limit | 确认要求 |
|------|----------|------------|----------|
| `safe` | GET + public data | 120/min | 无 |
| `low` | GET + private data | 60/min | 无 |
| `medium` | POST + 可逆操作 | 30/min | 无 |
| `high` | POST + 不可逆操作 | 10/min | 需确认 |
| `critical` | DELETE / 金融操作 | 5/min | 需二次确认 |

判定规则是 deterministic 的：基于 HTTP method、endpoint path pattern、operation 语义标注。不依赖 LLM 推理。

## Rate Limiting

每个 risk tier 有独立的 rate limiter。限制按网站粒度隔离，不同网站之间不互相影响。

超出限制时返回 `rate_limited` error，不排队等待。

## Website Security Taxonomy（参考模型）

六层分类，用于理解网站安全复杂度，不直接用于 runtime 实现：

| Level | 描述 | 示例 |
|-------|------|------|
| 1 | 无认证的公开 API | 公开 RSS feed |
| 2 | 标准 API key / Bearer token | Bluesky, OpenAI |
| 3 | Cookie-based session + CSRF | Instagram, Reddit |
| 4 | Cookie + 自定义 signing | YouTube (SAPISIDHASH) |
| 5 | 混淆签名算法 | OnlyFans, TikTok |
| 6 | 非 HTTP protocol | WhatsApp, Telegram |

这个分类帮助确定每个网站需要 L1 / L2 / L3 中的哪一层来处理。

## SSRF Protection

防止 server-side request forgery 的三层防御：

1. **Hostname validation** — 只允许向 openapi.yaml 中声明的 server 域名发请求
2. **Private IP rejection** — 解析 DNS 后检查，阻止向 `10.x.x.x`、`172.16.x.x`、`192.168.x.x`、`127.0.0.1` 等 private IP 发请求
3. **Metadata endpoint blocking** — 阻止访问 cloud provider 的 metadata endpoint（`169.254.169.254` 等）

此外，强制使用 HTTPS（不允许 HTTP），防止中间人攻击。
