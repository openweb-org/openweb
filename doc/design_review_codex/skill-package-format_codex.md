# Review: skill-package-format.md

## TL;DR
包结构设计完整，但文件类型过多，存在“多源真相”风险。建议先建立单一事实源，再按需生成派生文件。

## 主要问题

### P0: 包结构过重，不利于 MVP 快速验证
- `tools/workflows/templates/extractors/verifiers/tests/fingerprints/bridge` 全量齐备。
- 对首版来说，维护面过大。

### P1: 信息重复导致漂移
- `manifest.json` 的计数字段、`SKILL.md` 工具列表、`tools/*.json` 可能不一致。
- 建议把 `tools/*.json` 作为唯一源，其他文件构建时生成。

### P1: 文档内流程与安全文档存在冲突
- 本文 Step 2.5 仍是线性 probing（direct->cookie->csrf->headless）。
- 与 `security-taxonomy.md` 的独立维度探测不一致。
- 需要统一为一个协议来源，其他文档引用。

### P1: 运行面接口可能过多
- 既有 `web_skill_call`，又动态注册每站点每工具。
- 早期建议先保留统一入口，动态注册留到稳定后。

## KISS 化简建议
1. 最小包结构：
   - `manifest.json`
   - `tools/*.json`（唯一事实源）
   - `tests/*.json`
   - `runtime/bridge.js`
2. workflow、fingerprint、verifier 先作为可选扩展。
3. `manifest` 仅保留静态元数据，不存可推导计数。
4. 强制 schema 版本字段（如 `spec_version`）以支持未来迁移。

## 结论
当前格式偏终态设计。建议先把“可执行最小包”跑通，再逐步增加目录层次，避免早期过度工程化。
