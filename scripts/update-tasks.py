#!/usr/bin/env python3
"""Write-only operations on doc/internal/todo/tasks.json with cross-record validation."""
import json, sys
from pathlib import Path

FILE = Path("doc/internal/todo/tasks.json")
STATES = {"ready", "running", "done", "blocked", "cancelled"}
TERMINAL = {"done", "cancelled"}

def load():
    return json.loads(FILE.read_text()) if FILE.exists() else {}

def save(tasks):
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(tasks, indent=2, ensure_ascii=False) + "\n")

def die(msg):
    print(f"error: {msg}", file=sys.stderr); sys.exit(1)

def validate_types(data):
    checks = {
        "parent": (str, type(None)),
        "depends": (list,),
        "state": (str,),
        "scope": (list,),
        "requireHumanReview": (bool,),
    }
    for k, types in checks.items():
        if k in data and not isinstance(data[k], types):
            die(f"'{k}' must be {'/'.join(t.__name__ for t in types)}")
    # acceptCriteria: str or list[str]
    ac = data.get("acceptCriteria")
    if ac is not None:
        if isinstance(ac, str):
            pass  # ok
        elif isinstance(ac, list):
            if not all(isinstance(x, str) for x in ac):
                die("acceptCriteria list items must be strings")
        else:
            die("acceptCriteria must be str or list[str]")
    # resources: str or list[str]
    res = data.get("resources")
    if res is not None:
        if isinstance(res, str):
            pass  # ok
        elif isinstance(res, list):
            if not all(isinstance(x, str) for x in res):
                die("resources list items must be strings")
        else:
            die("resources must be str or list[str]")

def validate_refs(tasks, tid, task):
    if task.get("parent") == tid or tid in task.get("depends", []):
        die("self-reference")
    p = task.get("parent")
    if p is not None and p not in tasks:
        die(f"parent '{p}' not found")
    for d in task.get("depends", []):
        if d not in tasks:
            die(f"depends '{d}' not found")

def check_cycles(tasks):
    # Parent chain
    for tid in tasks:
        visited = set()
        cur = tid
        while cur:
            if cur in visited: die(f"cycle in parent chain: {cur}")
            visited.add(cur)
            cur = tasks[cur].get("parent")
    # Depends — DFS
    GRAY, BLACK = 1, 2
    color = {}
    def dfs(t):
        color[t] = GRAY
        for d in tasks[t].get("depends", []):
            if color.get(d) == GRAY: die(f"cycle in depends: {d}")
            if d not in color: dfs(d)
        color[t] = BLACK
    for t in tasks:
        if t not in color: dfs(t)

def has_children(tasks, tid):
    return any(t.get("parent") == tid for t in tasks.values())

def validate_state(tasks, tid, old_state, new_state):
    if new_state not in STATES: die(f"invalid state '{new_state}'")
    if has_children(tasks, tid) and new_state != old_state:
        die(f"cannot set state on milestone task (state derived from children)")
    if new_state == "running" and old_state != "running":
        for d in tasks[tid].get("depends", []):
            if tasks[d]["state"] not in TERMINAL:
                die(f"depends '{d}' not terminal (state={tasks[d]['state']})")

def rollup(tasks, tid):
    pid = tasks[tid].get("parent")
    if not pid or pid not in tasks: return
    children = [t for t in tasks if tasks[t].get("parent") == pid]
    all_term = all(tasks[c]["state"] in TERMINAL for c in children)
    ps = tasks[pid]["state"]
    if all_term and ps not in TERMINAL:
        tasks[pid]["state"] = "done"; rollup(tasks, pid)
    elif not all_term and ps == "done":
        tasks[pid]["state"] = "running"; rollup(tasks, pid)

def _ac_is_blank(ac):
    """Check if acceptCriteria is effectively blank."""
    if ac is None:
        return True
    if isinstance(ac, str):
        return not ac.strip()
    if isinstance(ac, list):
        return len(ac) == 0 or all(not x.strip() for x in ac)
    return True

def cmd_set(tid, data):
    validate_types(data)
    tasks = load()
    old_state = tasks.get(tid, {}).get("state")
    if tid in tasks:
        tasks[tid].update(data)
    else:
        missing = {"title", "description"} - data.keys()
        if missing: die(f"new task requires: {', '.join(sorted(missing))}")
        tasks[tid] = {"parent": None, "depends": [], "state": "ready", **data}
    # Enforce non-empty acceptCriteria on leaf tasks
    if not has_children(tasks, tid) and _ac_is_blank(tasks[tid].get("acceptCriteria")):
        die("leaf task requires non-empty acceptCriteria")
    validate_refs(tasks, tid, tasks[tid])
    validate_state(tasks, tid, old_state, tasks[tid]["state"])
    check_cycles(tasks)
    rollup(tasks, tid)
    save(tasks)

def cmd_rm(tid):
    tasks = load()
    if tid not in tasks: die(f"task '{tid}' not found")
    if tasks[tid]["state"] == "running": die("cannot remove running task (cancel first)")
    for oid, o in tasks.items():
        if oid == tid: continue
        if o.get("parent") == tid: die(f"task '{oid}' has parent '{tid}'")
        if tid in o.get("depends", []): die(f"task '{oid}' depends on '{tid}'")
    pid = tasks[tid].get("parent")
    del tasks[tid]
    if pid and pid in tasks:
        # Remaining siblings may now all be terminal → rollup parent
        children = [t for t in tasks if tasks[t].get("parent") == pid]
        if children:
            rollup(tasks, children[0])
    save(tasks)

if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2: die("usage: update-tasks.py set <id> [json] | rm <id>")
    cmd, tid = args[0], args[1]
    if cmd == "set":
        raw = args[2] if len(args) > 2 else sys.stdin.read()
        try: data = json.loads(raw)
        except json.JSONDecodeError as e: die(f"invalid JSON: {e}")
        cmd_set(tid, data)
    elif cmd == "rm":
        cmd_rm(tid)
    else:
        die(f"unknown command: {cmd}")
