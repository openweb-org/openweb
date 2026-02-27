# Review: security-taxonomy.md

## TL;DR
分层安全模型有价值，但当前 taxonomy 维度较细，探测策略在现实系统中容易触发噪声和误判。建议引入“未知态 + 风险预算 + 最小判定集”。

## 主要问题

### P0: 分类粒度过细，超出可稳定判定能力
- 文档把机制拆到很多子项（TLS/指纹/CDP/行为等）。
- 但很多信号在单次探测下不可可靠判定。
- 缺少 `unknown` 一等状态会导致过度自信分类。

### P1: 探测协议可能触发风控
- 明确提出 wrong-origin、多客户端 TLS 对照、headless/headed 对照。
- 在真实站点上会提高封禁概率，且会污染会话。
- 需要每站点和每 endpoint 的探测预算与速率上限。

### P1: 推导伪代码变量不完整
- `needs_csrf`、`needs_cookies` 在伪代码里被使用但未显式赋值规则化。
- 实施时容易出现执行策略漂移。

### P1: “写接口默认跳过探测”是实用选择，但会掩盖低成本可调用场景
- 例如部分 write endpoint 仅 bearer token 即可。
- 建议保留“只做无副作用预探测”的轻量路径（OPTIONS/validation endpoint/草稿接口）。

## KISS 化简建议
1. 每 endpoint 先收敛成 5 维最小画像：
   - `auth_class`
   - `csrf_required`
   - `browser_required`
   - `human_required`
   - `side_effect_risk`
2. 任何无法稳定验证的维度，强制标记 `unknown`，并上调执行模式。
3. 探测引擎增加硬限制：
   - 每 endpoint 最大探测次数
   - 全局 QPS
   - 失败后冷却
4. 安全画像输出必须附证据片段（哪次请求、哪种失败码）。

## 结论
该文档理论结构优秀，但工程化前需降低“可判定假设”。先做能稳定重复的最小分类，比追求精细 taxonomy 更关键。
