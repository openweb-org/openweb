# Todoist

## Overview
Task management platform — productivity/personal-organization archetype.

## Workflows

### List projects and browse tasks
1. `getProjects()` → id, name, is_inbox_project
2. `getTasks(project_id)` → id, content, due, priority, labels

### Create a task
1. `getProjects()` → `id` (= `project_id`)
2. `createTask(content, project_id ← getProjects, due_string, priority)` → `id`, `content`, `due`

### Complete a task
1. `getTasks(project_id)` → `id` (= `task_id`), `content`
2. `completeTask(task_id ← getTasks)` → success

### Reopen a completed task
1. Known `task_id` (from prior getTasks or createTask)
2. `uncompleteTask(task_id)` → success (reverse of completeTask)

### Delete a task
1. `getTasks(project_id)` → `id` (= `task_id`), `content`
2. `deleteTask(task_id ← getTasks)` → success (permanent, irreversible)

### Filter tasks by due date or priority
1. `getTasks(filter: "today")` → tasks due today
2. `getTasks(filter: "priority 1")` → urgent tasks

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProjects | list all projects | — | id, name, color, is_inbox_project | entry point for project IDs |
| getTasks | tasks in a project | project_id ← getProjects | content, due, priority, labels | supports filter expressions |
| createTask | create a new task | content, project_id ← getProjects | id, content, due, url | write op |
| completeTask | mark task done | task_id ← getTasks | success | write op, reverse: uncompleteTask |
| uncompleteTask | reopen completed task | task_id ← getTasks | success | write op, reverse of completeTask |
| deleteTask | permanently delete task | task_id ← getTasks | success | write op, irreversible |

## Quick Start

```bash
# List all projects
openweb todoist exec getProjects '{}'

# Get tasks in a project
openweb todoist exec getTasks '{"project_id":"2203306141"}'

# Get today's tasks
openweb todoist exec getTasks '{"filter":"today"}'

# Create a task
openweb todoist exec createTask '{"content":"Buy groceries","due_string":"tomorrow","priority":2}'

# Complete a task
openweb todoist exec completeTask '{"task_id":"7025654312"}'

# Reopen a completed task
openweb todoist exec uncompleteTask '{"task_id":"7025654312"}'

# Delete a task permanently
openweb todoist exec deleteTask '{"task_id":"7025654312"}'
```
