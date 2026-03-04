---
name: strategic-compact
description: Suggest context compaction at logical task boundaries. Use after completing milestones or before switching tasks.
---

# Strategic Compact

Strategic context compaction at logical task boundaries.

## Why Strategic > Auto

Auto-compaction triggers arbitrarily (often mid-task). Strategic compaction preserves important context.

## When to Compact

**Good times:**
- After planning, before implementation
- After debugging session resolves
- After completing a milestone
- Before switching to unrelated task

**Bad times:**
- Mid-implementation
- While debugging
- During multi-file refactoring

## Workflow Integration

```
/plan → [plan finalized] → /strategic-compact → implement
                                                    ↓
                                       [milestone complete] → /strategic-compact → next task
```

## Reminder Thresholds

Consider compacting after:
- 50+ tool calls in session
- Completing a planning phase
- Resolving a complex bug
- Major context shift

## Best Practice

1. Complete logical unit of work
2. Review what context is essential going forward
3. Compact with summary of key decisions
4. Continue with fresh context
