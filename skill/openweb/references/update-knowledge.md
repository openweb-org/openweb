# Update Knowledge

After completing any workflow (discover, compile, troubleshoot) that taught you something new.

## Principles

- Only save what's novel — don't duplicate what's in the code
- Save patterns, not instances — "Next.js sites use `__NEXT_DATA__`" not "Walmart uses `__NEXT_DATA__`"
- Keep files <200 lines — split when a file grows too large

## Process

### 1. Evaluate

What did you learn that isn't already in `knowledge/`?

### 2. Classify

Which knowledge file does it belong to?

- `knowledge/auth-patterns.md` — auth, CSRF, signing patterns
- `knowledge/archetypes.md` — site categories and expected behaviors
- Create a new file in `knowledge/` if neither fits

### 3. Write

Append to the appropriate `knowledge/` file. Follow the existing format.

### 4. Update Process Guide (if needed)

If the learning changes the recommended process, update `discover.md`, `compile.md`, or `troubleshooting.md`.
