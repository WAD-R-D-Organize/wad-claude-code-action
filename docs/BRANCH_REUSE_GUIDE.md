# Branch Reuse Strategy Guide

This guide explains how to use Claude Code Action's intelligent branch reuse feature to optimize your development workflow.

## Overview

The branch reuse feature minimizes the creation of redundant branches by intelligently reusing existing branches from the same issue when appropriate. This helps keep your repository clean while still allowing for explicit control when new branches are needed.

## Configuration Options

### `branch_reuse_strategy`

Controls how Claude handles branch creation and reuse:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `always_new` | Always creates new branches (traditional behavior) | When you want maximum isolation between interactions |
| `smart_reuse` | **Default** - Reuses branches unless explicitly requested otherwise | Recommended for most workflows |
| `always_reuse` | Always tries to reuse existing branches when available | When branch consolidation is preferred |

### `branch_push_strategy`

Works in coordination with branch reuse:

| Strategy | Behavior |
|----------|----------|
| `immediate` | Push branches to remote immediately after creation |
| `deferred` | Push branches on first commit |
| `auto` | **Default** - Smart selection based on context (commit signing, etc.) |

## How Smart Reuse Works

### Intent Detection

Claude automatically detects user intent through multilingual pattern matching:

#### Phrases that trigger NEW branch creation

**English:**

- "create a new branch"
- "start fresh branch"
- "new feature branch"
- "separate branch"
- "don't reuse existing branch"

**中文 (Chinese):**

- "新建分支"
- "創建新的分支"
- "重新開始"
- "不要沿用現有分支"
- "新增分支"

**日本語 (Japanese):**

- "新しいブランチ"
- "ブランチを作成"

#### Phrases that encourage REUSE

**English:**

- "continue on this branch"
- "use existing branch"
- "reuse current branch"
- "keep using this branch"

**中文 (Chinese):**

- "繼續使用現有分支"
- "沿用這個分支"
- "復用分支"

### Branch Validation

Before reusing a branch, the system validates:

- ✅ Branch still exists and is accessible
- ✅ Not too far behind base branch (< 50 commits behind)
- ✅ Not stale (< 30 days since last activity)
- ✅ Submodule branches are also available (if using submodules)

## Usage Examples

### Basic Configuration

```yaml
- name: Claude Code Action
  uses: anthropics/claude-code-github-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    branch_reuse_strategy: smart_reuse  # Enable intelligent reuse
    branch_push_strategy: auto          # Coordinate with reuse
```

### With Submodules

```yaml
- name: Claude Code with Submodules
  uses: anthropics/claude-code-github-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    branch_reuse_strategy: smart_reuse   # Reuse main + submodule branches
    enable_submodule_branches: true     # Enable submodule support
    branch_push_strategy: auto          # Coordinate push strategy
```

### Conservative Approach (Always New)

```yaml
- name: Claude Code Conservative
  uses: anthropics/claude-code-github-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    branch_reuse_strategy: always_new   # Traditional behavior
```

### Aggressive Reuse

```yaml
- name: Claude Code Aggressive Reuse
  uses: anthropics/claude-code-github-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    branch_reuse_strategy: always_reuse # Maximum consolidation
```

## Practical Scenarios

### Scenario 1: Iterative Development

**Issue #123: "Implement user authentication"**

```
Comment 1: "@claude implement basic login functionality"
→ Creates: claude/issue-123-20240813-1430

Comment 2: "@claude also add password validation"
→ Reuses: claude/issue-123-20240813-1430 (continues on same branch)

Comment 3: "@claude create a new branch for OAuth integration"
→ Creates: claude/issue-123-20240813-1445 (explicit new branch request)
```

### Scenario 2: Bug Fixes

**Issue #456: "Fix payment processing bugs"**

```
Comment 1: "@claude fix the credit card validation issue"
→ Creates: claude/issue-456-20240813-0900

Comment 2: "@claude the validation is good, now fix the amount calculation"
→ Reuses: claude/issue-456-20240813-0900 (related work continues)

Comment 3: "@claude start fresh for the PayPal integration bug"
→ Creates: claude/issue-456-20240813-0930 (separate issue, new branch)
```

### Scenario 3: Multilingual Usage

**Issue #789: "多語言支持功能"**

```
Comment 1: "@claude 實現基本的多語言功能"
→ Creates: claude/issue-789-20240813-1200

Comment 2: "@claude 繼續這個工作，添加中文支持"
→ Reuses: claude/issue-789-20240813-1200 (continues work)

Comment 3: "@claude 新建分支來處理日語支持"
→ Creates: claude/issue-789-20240813-1215 (new branch requested)
```

## Branch Naming Convention

Branches follow the pattern: `{prefix}{type}-{number}-{timestamp}`

- `prefix`: Configurable (default: `claude/`)
- `type`: `issue` or `pr`
- `number`: Issue or PR number
- `timestamp`: Creation time (YYYYMMDD-HHMM)

Examples:
- `claude/issue-123-20240813-1430`
- `claude/pr-456-20240813-0900`

## Submodule Coordination

When `enable_submodule_branches: true`:

- Main repository and submodule branches are coordinated
- Branch reuse applies to both main repo and submodules
- Mixed scenarios are handled (e.g., main branch reused, submodule branch new)
- Failed submodule operations don't block main repository work

## Best Practices

### ✅ Recommended

1. **Use `smart_reuse` strategy** for most workflows
2. **Be explicit** when you need new branches: "create a new branch"
3. **Group related work** by continuing on existing branches
4. **Use descriptive comments** to help intent detection
5. **Enable submodule coordination** if using git submodules

### ⚠️ Considerations

1. **Branch validation** may reject very stale branches
2. **Permissions** must allow branch access for reuse
3. **Submodule access** requires proper authentication
4. **Mixed language** comments may confuse intent detection

### ❌ Avoid

1. Don't mix unrelated features on the same branch
2. Don't assume branch reuse without checking the logs
3. Don't disable branch validation in production

## Troubleshooting

### Branch Not Found

If a branch expected to exist is not found:
- Check branch naming in GitHub
- Verify repository permissions
- Check Claude's comment history for branch creation logs

### Intent Not Detected

If Claude doesn't detect your intent correctly:
- Be more explicit: "please create a new branch"
- Use supported phrases from the lists above
- Check the action logs for intent analysis results

### Submodule Issues

If submodule branches aren't working:
- Ensure submodules are properly initialized
- Check authentication for submodule repositories
- Verify `enable_submodule_branches: true` in configuration

## Migration Guide

### From Traditional Approach

If currently using always-new branches:

1. Add `branch_reuse_strategy: smart_reuse` to your configuration
2. Educate team on intent detection phrases
3. Monitor first few interactions to ensure expected behavior
4. Adjust strategy based on team preferences

### To Aggressive Reuse

If you want maximum branch consolidation:

1. Set `branch_reuse_strategy: always_reuse`
2. Use explicit "new branch" requests for separation
3. Monitor branch age and staleness
4. Consider more frequent branch cleanup

## Complete Example

See [`examples/claude-branch-reuse.yml`](../examples/claude-branch-reuse.yml) for a comprehensive configuration example with detailed comments and usage patterns.