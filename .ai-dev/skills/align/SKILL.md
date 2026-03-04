---
name: align
description: Align the design of the system or anything else between Codex and Claude.
---

# Align

Align the design of the system or anything else between Codex and Claude.

## 目录约定

```
[project_folder]/
  discussion/
    status.txt                 # 独立状态文件（单行）
    0001_CODEX.md              # 每次发言一个新文件（只增不改）
    0002_CLAUDE.md
    ...
  final/
    *.md                       # 最终对齐产物（可多个文件）
    ...
```

注意： final/ 下的文件，应该是一份或多份self-contained的documents (designs, analyses or whatever they should be)，完整清晰可读，不需要用户再去读individual design来了解上下文。而不应该只记录矛盾冲突的解决结果，比如全文主要以key decisions来organize，并缺对已经reach consensus的部分着墨太少，或者缺乏设计/分析细节等等，it should read like a complete document.

---

## status.txt（单行格式）

固定一行，key=value 用空格分隔：

```
SEQ=0000 NEXT=CODEX CODEX=PENDING CLAUDE=PENDING
```

字段/取值：

* `SEQ`: 递增整数（每轮 +1）
* `NEXT`: `CODEX` / `CLAUDE` / `DONE`
* `CODEX`, `CLAUDE`: `PENDING` / `APPROVE` / `CHANGES`

---

## 极简状态机

* `NEXT=CODEX`：轮到 Codex 写
* `NEXT=CLAUDE`：轮到 Claude 写
* 结束条件：`CODEX=APPROVE` 且 `CLAUDE=APPROVE` → `NEXT=DONE`

---

## SOP（两边都照做）

### 0) 开始
- 一般会通过prompt指定开始的一方。开始的一方初始化folders etc. 
- If there is no initial draft, based on available references, e.g., individual designs, codebase, etc., come with a initial draft to document the consesus, and clarify the conflicts, different opinions, and open questions.

### A) 如果 `status.txt` 里 `NEXT` 不是你

1. **不要读/想/写任何东西**，只做轮询等待。
2. 用轮询脚本阻塞等待（**不要自己手写 sleep 循环，会污染 context**）：

   ```bash
   .ai-dev/skills/align/scripts/align_poll.sh <path/to/discussion/status.txt> <Your agent name:CLAUDE|CODEX>
   ```

   脚本会阻塞，仅在轮到你或 DONE 时输出一行（`YOUR_TURN` / `DONE`），所有轮询细节写入 `poll.log`。
3. 收到 `YOUR_TURN` → 转到 B；收到 `DONE` → 转到 C。

### B) 如果 `status.txt` 里 `NEXT=你`

你是**唯一允许写入**的人（discussion 和 final 都只能你改）。

1. 读取 `discussion/` 下所有讨论文件（按 SEQ 升序），尤其是对方的新讨论文件。
2. 如需更新最终对齐产物：修改/新增 `final/*`。尽可能避免完全覆盖式的修改，而是增量式的修改，不然你和对方都很难知道到底改了什么，不利于alignment discussion。
3. 在 `discussion/` 新建一个讨论文件（**只新建，不修改旧文件**）：

   * 文件名：`{newSEQ}_{YOU}.md`（例如 `0003_CODEX.md`）
   * 内容尽量短：本轮结论、改了什么、仍未解决的问题、你的最终投票（APPROVE/CHANGES）。
4. 更新 `discussion/status.txt`（仍然单行）：

   * `newSEQ = SEQ + 1`
   * 设定你自己的投票：`YOU=APPROVE` (只有本轮未对final/* 进行过任何改动时才可选APPROVE) 或 `YOU=CHANGES` （只要本轮对final/* 进行过任何改动，就必须选择CHANGES）
   * **如果你对 final 做了任何实质改动**（改方案/接口/约束/假设等），把对方投票重置为 `PENDING`
   * 若此时双方都 `APPROVE`：写 `NEXT=DONE`
   * 否则：写 `NEXT=对方`
5. 写完后再次调用轮询脚本等待对方回应或 DONE：

   ```bash
   .ai-dev/skills/align/scripts/align_poll.sh <path/to/discussion/status.txt> <CLAUDE|CODEX>
   ```

### C) 如果 `status.txt` 里 `NEXT=DONE`
如果你和对方均已经APPROVE，结束轮询。

**status 更新示例：**

* Codex 提修改，交给 Claude：

  ```
  SEQ=0001 NEXT=CLAUDE CODEX=CHANGES CLAUDE=PENDING
  ```
* Claude 改完并 approve，同时让 Codex 复核（重置 Codex=PENDING）：

  ```
  SEQ=0002 NEXT=CODEX CODEX=PENDING CLAUDE=APPROVE
  ```
* Codex 复核后 approve，结束：

  ```
  SEQ=0003 NEXT=DONE CODEX=APPROVE CLAUDE=APPROVE
  ```

---

## 额外硬规则（保证简单稳定）
* **只有 `NEXT=你` 时才允许写任何文件**（包括 `final/*` 和 `discussion/*`）。
* 讨论只增量：永远新建 `####_AGENT.md`，不要回改旧讨论文件。

## Align Principles
- 过程中有任何对方有和你不同意见，或者对方提到而你没提到的地方，不要make assumptions，看代码，上网查，做数据分析等等，用证据解决分歧。
- 你会保持open-minded，但也会坚持原则，不随意妥协，和对方讨论，直到达成共识。你的目标不是快速达成共识，而是达成高质量的共识。
- 对于关键问题的分歧，如果多轮讨论后无法解决分歧，在文档的最后总结成open questions，交还给master user来决策。

## Design Principles
Think, discuss and write the design, following how the best people in the field will do it, e.g., best system architect (Linus Torvalds), and also the best AI researcher (Jeff Dean & Ilya Sutskever).
- 拥抱KISS principle，keep it simple stupid. 避免过度设计，避免过度工程化。嵌套层数不要太深。
- 大道至简，我希望我的code是minimal nested layers, minimal redundancy。 如果你能用更简单的逻辑实现同样的功能，do it。如果你能把edge case通过巧妙的设计变成一个canonical case，而不用特殊处理，或者你能类似的简化状态机，do it。
- 设计high readability的code。
- 设计的过程，不要考虑代码的backward compatibility，最后把陈旧的历史代码可以直接deprecate，我产品还没有release，不需要考虑任何向后兼容。代码质量高，可读性高，只需要反映最新最优的实现，这对我更重要。
- 阅读我已有的代码，确保你的设计跟现有的codebase是aligned。