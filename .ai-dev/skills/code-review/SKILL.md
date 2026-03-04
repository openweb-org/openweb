---
name: code-review
description: Systematic code review with severity-based findings. Use before merging or when reviewing changes.
---

# Code Review

Systematic review process with high standards.

## Guidelines
Analyze the code changes based on the following pillars:

*   **Correctness**: Does the code achieve its stated purpose without bugs or logical errors?
*   **Maintainability**: Is the code clean, well-structured, and easy to understand and modify in the future? Consider factors like code clarity, modularity, and adherence to established design patterns.
*   **Readability**: Is the code well-commented (where necessary) and consistently formatted according to our project's coding style guidelines?
*   **Efficiency**: Are there any obvious performance bottlenecks or resource inefficiencies introduced by the changes?
*   **Security**: Are there any potential security vulnerabilities or insecure coding practices?
*   **Edge Cases and Error Handling**: Does the code appropriately handle edge cases and potential errors?
*   **Testability**: Is the new or modified code adequately covered by tests (even if preflight checks pass)? Suggest additional test cases that would improve coverage or robustness.

## Review Mindset

High standards like kernel code. Find:
- Logic holes
- Design principle violations
- Risks and bugs
- Redundancies

## Process

1. **Get context**
   ```bash
   git diff --stat
   git log -3 --oneline
   ```

2. **Review changes** against checklist

3. **Document findings** by severity

4. **Fix small issues** inline

5. **Create design docs** for big issues

## Severity Levels

### Critical (Must Fix)
- Security: secrets, injection, SSRF bypass, leaks
- Crashes: unhandled exceptions, uncaught promise rejections
- Data loss: state corruption, race conditions

### High (Should Fix)
- Correctness: errors / bugs
- Maintainability: Spaghetti code, confusing logic, significant code duplication
- Efficiency: significant efficiency issue
- Resource leaks (file handles, browser contexts)
- Unhandled async errors
- Missing input validation at system boundaries

### Medium (Consider)
- Readability: Hard to read logic, moderate code duplication
- Missing tests
- Large files/functions
- Poor naming

### Low (Nice-to-Have)
- Style consistency
- Documentation gaps
- Minor optimizations

## Project-Specific Checks

- [ ] Async operations properly awaited?
- [ ] No resource leaks (Playwright browsers, file handles)?
- [ ] SSRF protection on outbound HTTP requests?
- [ ] CLI exit codes and stderr/stdout used correctly?
- [ ] OpenAPI output conforms to 3.1 spec?
- [ ] TypeScript strict mode satisfied (no `any` leaks)?

## Output Format

```markdown
# Review: [scope]

## Summary
[What changed]

## Critical
1. [Issue]: [why + where + fix]

## High
1. [Issue]: [why + where + fix]

## Medium
...

## Recommendation
[APPROVE / CHANGES_REQUESTED]
```

## Reference

- Treat `doc/` as context (code is source-of-truth)
- Update docs after fixing issues
