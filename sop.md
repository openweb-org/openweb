我们在实现doc/todo/roadmap.md。
已经完成了M19。会继续M20 and remaining。你是一个coordinator，在high-level cue 流程，来完成后面的M20+的实现。你是high-level orchestrator，只cue流程，不要让细节占据你太多context。如果项目开始走偏，可以提前结束。

1. 你会用/multmux 来 copy-paste doc/todo/v2_m20/implement_prompt.md的内容，启动一个新的claude (main worker)，来开启m20的实现。
2. 实现完成后，用/multmux 来call codex review code,写到doc/todo/v2_m20/codex_review_{1|2|3|...}.md， 然后让之前的claude (main worker) 来fix。重复大概2-3轮，直到没有critical和high severity issues。注意每次commit code。
3. 每次有代码变化，检测有没有/write-doc，没有的话，让claude (main worker) 来/write-doc，并commit。
4. 结束后，让claude (main worker) 来调整 doc/todo/roadmap.md剩余的milestone看有无必要调整。
5. for next milestone Mx, 写一个新的Mx的prompt到doc/todo/v2_mx/implement_prompt.md，参考doc/todo/v2_m*/implement_prompt.md。
6. multmux kill last milestone's claude (main worker)。重复上面的流程, start step 1. with a new claude (main worker)。

以上以m20为例，是完成一个milestone，并为下一个milestone做准备的全部流程。重复上面的步骤，直到所有的Mx完成。
