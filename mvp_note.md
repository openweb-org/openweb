## Phase 1: Explore & Record
1. 给定一个网站，或者一个natural language任务。如果任务未给定，agent思考或搜索该网站主要功能，生成一些任务描述，来capture用户对该网站的主要可能需求。
2. browser use agent使用chrome real user profile来浏览网站，完成上述任务描述的每一个任务。中间记录agent behaviors (llm history, actions), network traffic (HAR)。

## Phase 2: Analyze & Extract
1. 从录制信息中抽取openapi schema等信息。


## Phase 3: Probe and Classify
1. 设计一套probe protocol来测试一个endpoint的安全特征（是否需要auth，是否有CSRF保护，是否有origin check，是否有TLS fingerprinting等等。 update skill package。decorate openapi schema with enhanced info.

## Phase 4: Generate & Test
1. 生成per-site-skills。

## Execution Runtime
1. 实现一个简单的openweb cli工具。加载/parse skill package， 先实现direct_http请求。