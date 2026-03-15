# Runtime Executor 规范

## 概述

Runtime Executor 读取 OpenAPI spec 及其 `x-openweb` extensions，执行 operations。它是用户和 LLM 调用 OpenWeb 的唯一入口。

## CLI Interface

采用 progressive spec navigation，每步只暴露必要信息，token 消耗约 400（对比 MCP 的约 5000）：

```bash
openweb sites                        # 列出所有可用网站
openweb bluesky                      # 列出 Bluesky 的所有 operations
openweb bluesky getTimeline          # 查看 getTimeline 的参数和说明
openweb bluesky getTimeline --exec   # 执行
```

## 三种 Execution Mode

| Mode | 说明 |
|------|------|
| `direct_http` | 直接发 HTTP 请求，不需要浏览器 |
| `session_http` | 从 browser session 中提取 cookies/tokens，然后发 HTTP 请求 |
| `browser_fetch` | 在浏览器 page context 中通过 `fetch()` 发请求 |

### L2 Primitive 与最低 Mode 要求

| Primitive | 最低 Mode |
|-----------|-----------|
| Bearer token (固定) | `direct_http` |
| Cookie auth | `session_http` |
| CSRF token | `session_http` |
| page_global signing | `browser_fetch` |
| L3 adapter | `browser_fetch` |

## 七步 Execution Pipeline

```
1. auth        — 获取或注入认证凭据
2. csrf        — 提取 CSRF token（如需要）
3. signing     — 计算 request signature（如需要）
4. L3 adapter  — 调用 CodeAdapter（如需要）
5. HTTP request — 发送请求
6. error handling — 处理响应错误
7. pagination  — 自动翻页获取完整结果（如需要）
```

## Mode Escalation

当 `direct_http` 返回 401/403 时，自动升级到 `session_http`；若仍失败，升级到 `browser_fetch`。这是 self-healing 机制的一部分。

## Session Management

后台运行 browser daemon，管理所有网站的 browser session。空闲 5 分钟后自动关闭。每个网站维护独立的 browser context。

## Token Cache

- 按网站隔离，存储在 in-memory cache 中
- 收到 401/403 时自动清除对应网站的 cache
- 不持久化到磁盘

## Error Contract

```json
// 错误输出到 stderr，格式为 JSON
{
  "error": "auth",
  "message": "Session expired for instagram.com",
  "retry": true
}
```

exit code: `0` 表示成功，`1` 表示失败。

## Rate Limiting

按 risk tier 限制请求频率：

| Risk Tier | 限制 |
|-----------|------|
| `safe` | 120 次/分钟 |
| `low` | 60 次/分钟 |
| `medium` | 30 次/分钟 |
| `high` | 10 次/分钟 |
| `critical` | 5 次/分钟 |

## SSRF Protection

- 阻止向 private IP 地址发请求
- 强制 HTTPS
- 仅允许向 server allowlist 中的域名发请求

## Self-Healing

当 operation 执行失败时：

```
fingerprint comparison → mode escalation → flag for recompilation
```

首先对比网站当前 fingerprint 与 spec 中记录的是否一致；若不一致则尝试 mode escalation；若仍失败则标记该 operation 需要重新 compile。

## Execution 示例

### Bluesky — `direct_http`

公开 API，Bearer token 认证。直接发 HTTP 请求，无需浏览器。

```bash
openweb bluesky getTimeline --exec
# mode: direct_http
# auth: Bearer token from env
```

### Instagram — `session_http`

需要 cookie auth。从 browser session 中提取 cookies，附加到 HTTP 请求。

```bash
openweb instagram getFeed --exec
# mode: session_http
# auth: cookies from browser session
# csrf: X-CSRFToken from cookie
```

### YouTube — `session_http` + signing

需要 SAPISIDHASH signing。从 browser session 提取 SAPISID cookie，计算签名后发 HTTP 请求。

```bash
openweb youtube getSubscriptions --exec
# mode: session_http
# auth: cookies
# signing: SAPISIDHASH
```

### OnlyFans — `browser_fetch` + L3

需要自定义 request signing。在 browser context 中调用 L3 adapter 计算签名，然后通过 `fetch()` 发请求。

```bash
openweb onlyfans getMessages --exec
# mode: browser_fetch
# auth: cookies
# signing: L3 adapter (custom)
```

### WhatsApp — `browser_fetch` + L3

无 HTTP API。L3 adapter 通过 WhatsApp Web 的内部 module 系统操作。

```bash
openweb whatsapp sendMessage --exec
# mode: browser_fetch
# adapter: whatsapp (full L3)
```
