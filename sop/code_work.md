# Code Implementation Work
Given a goal/task (可能是一个system design，也可能是别的), you will conduct system implementation.

## TODOs management
Depending on the scope of the system design.
- If the system design scope is large, break it down to multiple Phases.
- If the system design scope is reasonable, treat it as one system design & implementation Phase.

## General Principles
Write the design like if you are Linus Torvalds.
- Design from first principles.
- 拥抱KISS principle，keep it simple stupid. 避免过度设计，避免过度工程化。嵌套层数不要太深。
- 大道至简，我希望我的code是minimal nested layers, minimal redundancy。 如果你能用更简单的逻辑实现同样的功能，do it。如果你能把edge case通过巧妙的设计变成一个canonical case，而不用特殊处理，或者你能类似的简化状态机，do it。
- 设计high readability的code。
- 设计的过程，不要考虑代码的backward compatibility，最后把陈旧的历史代码可以直接deprecate，我产品还没有release，不需要考虑任何向后兼容。代码质量高，可读性高，只需要反映最新最优的实现，这对我更重要。
- 阅读我已有的代码，确保你的设计跟现有的codebase是aligned。

- 这个feature对我的项目至关重要，请用 /ultra-think 来设计实现，深思熟虑，考虑周全。 @.ai-dev/skills/ultra-think/SKILL.md

# Code-Step-1: Design & Plan
For the specified design, if not already, come up with a plan to implement the design in multiple phases.

# Code-Step-2: Phased implementation
For each Phase, generate TODOs for the steps below. At each phase of the execution, repeat the following:

- 2.1 start executing the phase using ideally fresh context windows. use /coding-standards skill , /tdd skill when necessary. test and verify.
- 2.2 Start a new subagent to do an independent review with /code-review skill. write your review to the same folder as the design doc.
- 2.3 address the issues mentioned in the code review.
- 2.4 Git commit after every phase finishes.


# Code-Step-3: Verification and Wrap up
If needed, manually verify a test case end-to-end, to see if the system works as expected, beyond unit tests.

# Code-Step-4: Final verification
read all the codes you have written in Code-Step 1-3 above. see if it fully implements the goal/task (e.g., the system design doc). If not, go back to Code-Step-1 to restart planning and implementation.

DO NOT STOP UNTIL YOU FULLY IMPLEMENT THE TARGETED SCOPE!


# (Skip for now) Code-Step-4: Beautify Code Architecture
Improving code architecture quality.

# Important Notes

- /ultra-think ! This is really important piece for my whole project. Write really really well thought code. Write the code like you are Linus Torvalds.

- Manage your context properly. Use todos and subagents as you see fit.

- each of the `/xxx` mentioned above is a SKILL or AGENT, if you cannot interpret it as skill, read .ai-dev/{skills|agents}/xxx/SKILL.md directly.
