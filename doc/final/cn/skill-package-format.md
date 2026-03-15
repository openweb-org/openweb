# Skill Package 格式

## 概述

Skill Package 是 OpenWeb v2 的交付产物。每个网站对应一个 package，包含 runtime 执行所需的全部信息。

## 目录结构

```
bluesky/
  manifest.json        # package 元数据
  openapi.yaml         # API spec + x-openweb extensions
  asyncapi.yaml        # WebSocket/SSE spec（可选）
  adapters/            # L3 adapter 代码（可选）
    onlyfans-signing.ts
  tests/               # parity tests
    getTimeline.test.ts
```

**不包含**以下编译中间产物：

- capture bundle（录制数据）
- patterns.yaml（模式提取结果）
- extractors/（提取器代码）
- MCP/SKILL.md（旧格式）

## manifest.json

```json
{
  "name": "bluesky",
  "version": "1.2.0",
  "fingerprint": "sha256:abc123...",
  "dependencies": {
    "openweb-runtime": ">=2.0.0"
  },
  "stats": {
    "operations": 12,
    "l2_only": 12,
    "l3_adapters": 0
  }
}
```

| 字段 | 说明 |
|------|------|
| `name` | 网站标识符 |
| `version` | SemVer 格式的 package 版本 |
| `fingerprint` | 整个 package 内容的 composite hash |
| `dependencies` | runtime 版本要求 |
| `stats` | operation 统计信息 |

## openapi.yaml — Single Source of Truth

标准 OpenAPI 3.1 spec，加上 `x-openweb` vendor extensions。所有 runtime 需要的信息都在这一个文件中。

### x-openweb Schema

**server-level extensions**（适用于整个网站）：

```yaml
x-openweb:
  mode: session_http
  auth:
    type: cookie
    login_url: https://example.com/login
  csrf:
    type: meta_tag
    selector: 'meta[name="csrf-token"]'
    header: X-CSRF-Token
  signing:
    type: sapisidhash
    origin: https://example.com
```

**operation-level extensions**（适用于单个 operation）：

```yaml
paths:
  /api/timeline:
    get:
      operationId: getTimeline
      x-openweb:
        risk_tier: safe
        pagination:
          type: cursor
          param: cursor
          extract: $.cursor
        extraction:
          type: jsonpath
          path: $.feed[*]
        adapter: null  # L2 only, 无需 L3
```

## Package 示例

### Bluesky — 纯 L2

12 个 operations，全部用 L2 primitives 覆盖。Bearer token auth，cursor-based pagination。无 adapters/ 目录。

### Discord — L2 + AsyncAPI

REST API 用 OpenAPI 描述，Gateway WebSocket 用 AsyncAPI 描述。auth 为 Bearer token，部分 real-time events 通过 WebSocket 推送。

### WhatsApp — L3 dominant

几乎所有 operations 由 L3 adapter 处理。openapi.yaml 中的 operation 定义主要用于参数校验和文档，实际执行全部走 adapter。adapters/ 目录包含核心代码。

### Costco — multi-domain

涉及多个域名（costco.com、costcobusinessdelivery.com）。openapi.yaml 中定义多个 server，每个 server 有独立的 auth 和 csrf 配置。

## Version Management

三种版本机制：

| 类型 | 格式 | 用途 |
|------|------|------|
| Package version | SemVer (`1.2.0`) | 整个 package 的变更追踪 |
| Tool version | 整数 (`3`) | 单个 operation 的版本，LLM 缓存用 |
| Fingerprint | composite hash | 检测网站变更，触发 recompilation |
