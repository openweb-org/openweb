---
name: plan
description: Create implementation plan before coding. WAIT for confirmation. Use for new features, complex changes, or unclear requirements.
---

# Plan

Structured planning before implementation. Invokes the planner agent.

## When to Use

- Starting new feature
- Complex bugfix
- Architectural change
- Multiple files affected
- Requirements unclear

## Planning Steps

### 1. Understand Requirements

- What problem are we solving?
- What are the constraints?
- What's the success criteria?

### 2. Analyze Impact

```bash
# Find related code
grep -rn "RelatedModule" src/ --include="*.ts"
```

Questions:
- What components are affected?
- What dependencies exist?
- What could break?

### 3. Design Approach

- How does this fit existing architecture?
- What patterns should we follow?
- What are the alternatives?

### 4. Break Into Phases

```markdown
## Phase 1: [Foundation]
- [Task 1]: path/to/file.ts
- [Task 2]: path/to/file.ts
Risk: Low

## Phase 2: [Core Logic]
- [Task 3]: ...
Risk: Medium
Dependencies: Phase 1

## Phase 3: [Integration]
- [Task 4]: ...
Risk: High
```

### 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | M | H | [How to handle] |

### 6. Testing Strategy

- Unit: [what to test]
- Integration: [what flows]
- Manual: [what to verify]

## Output Format

```markdown
# Plan: [Feature Name]

## Summary
[2-3 sentences]

## Affected Components
- [file path]: [what changes]

## Phases

### Phase 1: [Name]
1. **[Step]** (`path/to/file.ts`)
   - Action: [specific change]
   - Risk: Low/Medium/High

### Phase 2: [Name]
...

## Risks
- [Risk]: [Mitigation]

## Testing Strategy
- Unit: [what to test]
- Manual: [what to verify]

**Proceed? (yes/modify/no)**
```

## Project-Specific Considerations

- CLI UX (exit codes, stderr for errors, stdout for output)
- OpenAPI 3.1 spec compliance
- Playwright integration (browser lifecycle, CDP)
- SSRF protection on runtime HTTP requests
- HAR parsing and schema inference correctness

## After Confirmation

- Use `/tdd` for core logic
- Use `/verify` before commit
