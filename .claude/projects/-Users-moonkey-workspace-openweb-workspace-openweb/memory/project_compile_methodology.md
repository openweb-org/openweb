---
name: compile_methodology
description: Core methodology — agent discovers APIs independently via CDP, OpenTabs is validation not reference
type: project
---

OpenTabs 插件代码是 validation（对答案），不是 reference（抄答案）。

正确的 compile 流程：
1. 给 agent 一个 website URL（target pool 来自 OpenTabs 的站点列表）
2. Agent 自己 browse website，通过 CDP capture 真实流量
3. Agent 发现 auth 如何搞，写出 openapi.yaml
4. 跟 OpenTabs 插件代码对比验证（对答案）
5. 过程中的 learning 沉淀到文档（auth patterns、endpoint discovery patterns 等）

**Why:** 这样积累的 learning 让以后每次 compile 又快又准。Agent 的能力在于独立发现，不是照抄已知答案。

**How to apply:** 任何涉及新站点 fixture 创建的 milestone，必须走 capture → compile → validate 流程，不能跳过 CDP 直接手写 openapi.yaml。M23 的 B/C-class fixtures 都是手写的，这是错误做法。
