# L3 Code Adapters 规范

## 为什么需要 L3

L2 primitives 覆盖约 93% 的网站。剩余约 7% 的网站存在以下情况，必须用自定义代码处理：

- **混淆的 request signing** — 网站在 JavaScript 中实现自定义签名算法，经过混淆后无法用声明式配置描述（OnlyFans、TikTok）
- **内部非 HTTP protocol** — 网站表面是 Web 应用，但内部通过 WebSocket 或自定义 protocol 与后端通信，没有可直接调用的 REST API（WhatsApp、Telegram）
- **webpack 中的 persisted query hash** — GraphQL 请求需要与前端代码编译时生成的 hash 匹配，hash 值嵌在 webpack bundle 中（Instacart）

## CodeAdapter Interface

```typescript
interface CodeAdapter {
  name: string;
  description: string;
  provides: string[];          // 该 adapter 提供的 operation 列表
  init(page: Page): Promise<void>;
  isAuthenticated(page: Page): Promise<boolean>;
  execute(page: Page, operation: string, params: Record<string, any>): Promise<any>;
}
```

## Execution Model

adapter 的 `execute()` 在浏览器的 `page.evaluate()` 中运行。这意味着代码直接在网站的 JavaScript context 中执行，能访问网站的全局变量、internal module 和运行时状态。

## Error Contract

所有错误统一为 ToolError，包含以下 error code：

| Code | 含义 |
|------|------|
| `auth` | 认证失败或 session 过期 |
| `not_found` | 请求的资源不存在 |
| `rate_limited` | 触发网站的频率限制 |
| `validation` | 参数校验失败 |
| `internal` | adapter 内部错误 |

## L2 + L3 组合

L3 不是孤立运行的。一个 operation 的 execution pipeline 可以组合 L2 和 L3：

```
auth → csrf → L3 signing → HTTP request → pagination
```

例如 OnlyFans：auth 和 csrf 由 L2 primitives 处理，仅 request signing 部分由 L3 adapter 完成，最终的 HTTP 请求和 pagination 仍由 L2 runtime 执行。

## Security Model

- adapter 代码在浏览器 page context 中运行
- 不能访问其他 tab 或 filesystem
- 不能发起任意网络请求（受浏览器同源策略限制）

## Trust Model

所有 adapter 代码都是 authored code — 要么由人工编写，要么由 compiler 生成 stub 后经过人工 review。不执行任何未经审核的自动生成代码。

## Adapter 示例

### OnlyFans

OnlyFans 的每个 API 请求都需要自定义签名 header。签名算法使用 request path、时间戳和一个从 JavaScript bundle 中提取的 static key 进行 hash 计算。算法经过混淆，无法用声明式配置表达。L3 adapter 在 page context 中调用网站自身的签名函数。

### TikTok

TikTok 的 API 请求包含 `X-Bogus` 和 `_signature` 参数，由高度混淆的 JavaScript 生成。签名依赖 browser fingerprint、request payload 和多个运行时状态。L3 adapter 直接调用 TikTok 前端代码中的签名函数，避免逆向混淆逻辑。

### Telegram

Telegram Web 使用 MTProto protocol 通过 WebSocket 通信，没有标准 REST API。L3 adapter 接入 Telegram Web 的内部 module 系统，通过其 JavaScript API 发送和接收消息，将 MTProto 操作映射为标准 operation。

### WhatsApp

WhatsApp Web 基于 Signal Protocol，通过 WebSocket 与服务端通信。所有消息经过端到端加密，没有可用的 HTTP API。L3 adapter 通过 WhatsApp Web 的内部 module 系统（`window.require`）调用消息收发功能。

### Instacart

Instacart 使用 GraphQL persisted queries。每个 query 有一个编译时生成的 hash，嵌在 webpack bundle 中。API 只接受 hash 而非完整 query text。L3 adapter 从当前加载的 webpack bundle 中提取 query hash 映射表，用正确的 hash 发起 GraphQL 请求。
