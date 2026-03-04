# Review: self-evolution.md

## TL;DR
“自进化”方向正确，但需要强约束。否则容易从“持续学习”滑向“不可控漂移”。

## 主要问题

### P0: “编译器改写自身”缺少变更防护
- 文档强调 procedural/declarative 两层区分，但执行策略上仍偏自动演进。
- 若 procedural 自动变更，会引入系统性回归。

### P1: 与其他文档存在策略冲突
- 7.1 提到“all requests within browser session”，与整体设计中的 `direct_http/session_replay` 不一致。
- 需要统一口径：浏览器内执行是 fallback 还是默认。

### P1: 知识库增长缺少质量门
- 当前强调“遇到新模式就写入 knowledge/”。
- 缺少去重、泛化、失效淘汰规则，长期会积累噪声。

### P1: 启发式跳探测有潜在安全风险
- “高置信度可 fast-path skip probing”可能导致误分类。
- 建议仅对只读 endpoint 开启，且需周期性抽检。

## KISS 化简建议
1. 进化分两条通道：
   - 自动：仅追加观测数据（history/stats）
   - 人审：把观测提升为规则（patterns/extractors/procedural）
2. procedural 默认冻结，必须 PR + 回归集通过才允许改。
3. 建立固定基准站点集（例如 10 个），每次规则升级必须全量回归。
4. 知识条目增加生命周期：`candidate -> validated -> deprecated`。

## 结论
自进化必须建立在“可回滚、可审计、可回归”之上。先保证稳定学习，再追求自动改写。
