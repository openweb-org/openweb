# Self-Evolution 概要

## 5 个 Hard Problems

OpenWeb compiler 面对的核心难题：

1. **Stateful auth** — 认证不是一次性的；session 过期、token 刷新、CSRF rotation 都需要持续处理
2. **Signed payloads** — 签名算法多样且经常混淆，从简单的 HMAC 到完全自定义的混淆函数
3. **Multi-request state machines** — 某些操作需要多步请求，前一步的返回值是后一步的输入（如 OAuth flow、分页、上传）
4. **GraphQL / WebSocket / SSE** — 非 REST 的通信模式，需要不同的 capture 和 replay 策略
5. **Legal / compliance** — 不同网站的 ToS 对自动化访问有不同限制

## 两层 Knowledge

| 类型 | 变化频率 | 内容 |
|------|----------|------|
| Procedural | 很少变 | compiler pipeline 的执行步骤、spec 生成逻辑 |
| Declarative | 经常变 | 识别模式、启发式规则、已知的失败案例 |

compiler 的核心逻辑（procedural）相对稳定。真正需要持续演进的是 declarative knowledge — 随着处理更多网站，不断积累新的 pattern 和 heuristic。

## Knowledge 结构

起步只需 3 个文件：

```
knowledge/
  patterns.md      # 已识别的安全模式（如 "meta tag CSRF 通常在 <head> 中"）
  heuristics.json  # 启发式规则（如 "header 名含 csrf/xsrf 的大概率是 CSRF token"）
  failures.md      # 失败案例和教训（如 "Instagram 的 X-IG-App-ID 是必须的"）
```

## Evolution Loop

```
load knowledge → run compiler → encounter new patterns → update knowledge
```

每次 compiler 处理一个新网站：

1. 加载当前 knowledge（patterns + heuristics + failures）
2. 执行 compiler pipeline（capture → analyze → probe → generate）
3. 遇到新的模式或失败时，记录到 knowledge 中
4. 下次编译时自动应用更新后的 knowledge

## L3 → L2 Promotion

v2 新增的核心演进机制：当一个 L3 pattern 出现在足够多的网站中，可以提升为 L2 primitive。

### Promotion Criteria

一个 L3 pattern 满足以下条件时可 promote 为 L2：

| 条件 | 阈值 |
|------|------|
| 独立网站数量 | >= 3 |
| 配置参数数量 | <= 10 |
| Runtime handler 代码行数 | <= 100 行 |

例如：如果 `SAPISIDHASH` 签名最初作为 L3 adapter 实现，后来发现 YouTube、Google Maps、Gmail 都用同一套逻辑，且只需 `origin` 一个参数就能配置，就可以 promote 为 L2 primitive。

### Knowledge Integrity

**Generalization test**：promote 为 L2 后，必须在所有已知使用该 pattern 的网站上通过 parity test。

**Regression testing**：每次 knowledge 更新后，对所有已编译的 package 运行回归测试，确保新 pattern 没有破坏已有行为。

**Conflict resolution**：当新 heuristic 与已有规则冲突时，以 parity test 结果为准 — test 通过的规则胜出。

**Lifecycle**：每条 knowledge 有状态流转：

```
candidate → validated → deprecated
```

- `candidate`：新发现，尚未充分验证
- `validated`：在多个网站上验证通过
- `deprecated`：被更好的规则替代或已不再适用

## Site Curriculum

网站按难度从 1 到 5 排列，compiler 按顺序处理：

| 难度 | 特征 | 示例 |
|------|------|------|
| 1 | 公开 API, Bearer token | Bluesky |
| 2 | Cookie auth, 简单 CSRF | Reddit |
| 3 | Cookie + 复杂 CSRF + pagination | Instagram |
| 4 | 自定义 signing (L2 可覆盖) | YouTube |
| 5 | 混淆签名或非 HTTP protocol (需要 L3) | OnlyFans, WhatsApp |

从简单网站开始积累 knowledge，逐步挑战更复杂的网站。低难度网站产出的 patterns 和 heuristics 会帮助处理更高难度的网站。
