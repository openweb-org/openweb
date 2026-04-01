## 2026-04-01: Rediscovery — 4 core operations

**What changed:**
- Rebuilt boss package from scratch with 4 target operations: searchJobs, getJobDetail, getCompanyProfile, getSalary
- Prior package (10 ops) included 7 reference data APIs; this rebuild focuses on user-requested core ops
- Added getSalary operation (search-based salary aggregation, not in prior package)
- Confirmed bot detection still quarantines site — page transport + adapter required

**Why:**
- User-requested rediscovery targeting specific operations
- Prior package deleted from worktree; rebuilt from git history reference

**Verification:** adapter-only package, runtime verify pending
**Commit:** pending
