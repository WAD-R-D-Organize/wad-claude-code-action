# Usage

Add a workflow file to your repository (e.g., `.github/workflows/claude.yml`):

```yaml
name: Claude Assistant
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned, labeled]
  pull_request_review:
    types: [submitted]

jobs:
  claude-response:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # Or use OAuth token instead:
          # claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}

          # Optional: provide a prompt for automation workflows
          # prompt: "Review this PR for security issues"

          # Optional: pass advanced arguments to Claude CLI
          # claude_args: |
          #   --max-turns 10
          #   --model claude-4-0-sonnet-20250805

          # Optional: add custom trigger phrase (default: @claude)
          # trigger_phrase: "/claude"
          # Optional: add assignee trigger for issues
          # assignee_trigger: "claude"
          # Optional: add label trigger for issues
          # label_trigger: "claude"
          # Optional: grant additional permissions (requires corresponding GitHub token permissions)
          # additional_permissions: |
          #   actions: read
          # Optional: allow bot users to trigger the action
          # allowed_bots: "dependabot[bot],renovate[bot]"
          # Optional: reuse existing issue branches instead of creating new ones
          # reuse_issue_branch: true
          # Optional: automatically assign users to issues when Claude starts working
          # auto_assign_issues: true
          # Optional: specify users to assign (if not provided, uses issue creator)
          # auto_assign_users: "user1,user2"
          # Optional: enable automatic submodule handling (default: true)
          # handle_submodules: true
          # Optional: customize submodule branch prefix
          # submodule_branch_prefix: "claude-sub/"
          # Optional: enable automatic issue metadata management
          # manage_issue_metadata: true
          # Optional: enable issue types management (requires org-level feature)
          # metadata_types_enabled: true
```

## Inputs

| Input                          | Description                                                                                                          | Required | Default   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------- | --------- |
| `anthropic_api_key`            | Anthropic API key (required for direct API, not needed for Bedrock/Vertex)                                           | No\*     | -         |
| `claude_code_oauth_token`      | Claude Code OAuth token (alternative to anthropic_api_key)                                                           | No\*     | -         |
| `prompt`                       | Instructions for Claude. Can be a direct prompt or custom template for automation workflows                          | No       | -         |
| `track_progress`               | Force tag mode with tracking comments. Only works with specific PR/issue events. Preserves GitHub context            | No       | `false`   |
| `claude_args`                  | Additional arguments to pass directly to Claude CLI (e.g., `--max-turns 10 --model claude-4-0-sonnet-20250805`)      | No       | ""        |
| `base_branch`                  | The base branch to use for creating new branches (e.g., 'main', 'develop')                                           | No       | -         |
| `use_sticky_comment`           | Use just one comment to deliver PR comments (only applies for pull_request event workflows)                          | No       | `false`   |
| `github_token`                 | GitHub token for Claude to operate with. **Only include this if you're connecting a custom GitHub app of your own!** | No       | -         |
| `use_bedrock`                  | Use Amazon Bedrock with OIDC authentication instead of direct Anthropic API                                          | No       | `false`   |
| `use_vertex`                   | Use Google Vertex AI with OIDC authentication instead of direct Anthropic API                                        | No       | `false`   |
| `mcp_config`                   | Additional MCP configuration (JSON string) that merges with the built-in GitHub MCP servers                          | No       | ""        |
| `assignee_trigger`             | The assignee username that triggers the action (e.g. @claude). Only used for issue assignment                        | No       | -         |
| `label_trigger`                | The label name that triggers the action when applied to an issue (e.g. "claude")                                     | No       | -         |
| `trigger_phrase`               | The trigger phrase to look for in comments, issue/PR bodies, and issue titles                                        | No       | `@claude` |
| `branch_prefix`                | The prefix to use for Claude branches (defaults to 'claude/', use 'claude-' for dash format)                         | No       | `claude/` |
| `settings`                     | Claude Code settings as JSON string or path to settings JSON file                                                    | No       | ""        |
| `additional_permissions`       | Additional permissions to enable. Currently supports 'actions: read' for viewing workflow results                    | No       | ""        |
| `experimental_allowed_domains` | Restrict network access to these domains only (newline-separated).                                                   | No       | ""        |
| `use_commit_signing`           | Enable commit signing using GitHub's commit signature verification. When false, Claude uses standard git commands    | No       | `false`   |
| `allowed_bots`                 | Comma-separated list of allowed bot usernames, or '\*' to allow all bots. Empty string (default) allows no bots      | No       | ""        |
| `reuse_issue_branch`           | In tag mode, check for and reuse existing issue branches instead of creating new ones                                                 | No       | `false`   |
| `auto_assign_issues`           | Automatically assign users to issues when Claude starts working                                                                       | No       | `false`   |
| `auto_assign_users`            | Comma-separated list of usernames to assign to issues (if not provided, will use issue creator)                                       | No       | ""        |
| `handle_submodules`            | Enable automatic submodule handling (initialization, branch creation, and commits)                                                    | No       | `true`    |
| `submodule_branch_prefix`      | The prefix to use for submodule branches (defaults to same as main branch_prefix). Only used when handle_submodules is true           | No       | ""        |
| `manage_issue_metadata`        | Enable automatic issue label and type management                                                                                      | No       | `false`   |
| `metadata_types_enabled`       | Enable issue types management (requires org-level issue types feature)                                                                | No       | `false`   |

### Deprecated Inputs

These inputs are deprecated and will be removed in a future version:

| Input                 | Description                                                                                  | Migration Path                                                 |
| --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `mode`                | **DEPRECATED**: Mode is now automatically detected based on workflow context                 | Remove this input; the action auto-detects the correct mode    |
| `direct_prompt`       | **DEPRECATED**: Use `prompt` instead                                                         | Replace with `prompt`                                          |
| `override_prompt`     | **DEPRECATED**: Use `prompt` with template variables or `claude_args` with `--system-prompt` | Use `prompt` for templates or `claude_args` for system prompts |
| `custom_instructions` | **DEPRECATED**: Use `claude_args` with `--system-prompt` or include in `prompt`              | Move instructions to `prompt` or use `claude_args`             |
| `max_turns`           | **DEPRECATED**: Use `claude_args` with `--max-turns` instead                                 | Use `claude_args: "--max-turns 5"`                             |
| `model`               | **DEPRECATED**: Use `claude_args` with `--model` instead                                     | Use `claude_args: "--model claude-4-0-sonnet-20250805"`        |
| `fallback_model`      | **DEPRECATED**: Use `claude_args` with fallback configuration                                | Configure fallback in `claude_args` or `settings`              |
| `allowed_tools`       | **DEPRECATED**: Use `claude_args` with `--allowedTools` instead                              | Use `claude_args: "--allowedTools Edit,Read,Write"`            |
| `disallowed_tools`    | **DEPRECATED**: Use `claude_args` with `--disallowedTools` instead                           | Use `claude_args: "--disallowedTools WebSearch"`               |
| `claude_env`          | **DEPRECATED**: Use `settings` with env configuration                                        | Configure environment in `settings` JSON                       |

\*Required when using direct Anthropic API (default and when not using Bedrock or Vertex)

> **Note**: This action is currently in beta. Features and APIs may change as we continue to improve the integration.

## Upgrading from v0.x?

For a comprehensive guide on migrating from v0.x to v1.0, including step-by-step instructions and examples, see our **[Migration Guide](./migration-guide.md)**.

### Quick Migration Examples

#### Interactive Workflows (with @claude mentions)

**Before (v0.x):**

```yaml
- uses: anthropics/claude-code-action@beta
  with:
    mode: "tag"
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    custom_instructions: "Focus on security"
    max_turns: "10"
```

**After (v1.0):**

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --max-turns 10
      --system-prompt "Focus on security"
```

#### Automation Workflows

**Before (v0.x):**

```yaml
- uses: anthropics/claude-code-action@beta
  with:
    mode: "agent"
    direct_prompt: "Update the API documentation"
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: "claude-4-0-sonnet-20250805"
    allowed_tools: "Edit,Read,Write"
```

**After (v1.0):**

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    prompt: |
      REPO: ${{ github.repository }}
      PR NUMBER: ${{ github.event.pull_request.number }}

      Update the API documentation to reflect changes in this PR
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --model claude-4-0-sonnet-20250805
      --allowedTools Edit,Read,Write
```

#### Custom Templates

**Before (v0.x):**

```yaml
- uses: anthropics/claude-code-action@beta
  with:
    override_prompt: |
      Analyze PR #$PR_NUMBER for security issues.
      Focus on: $CHANGED_FILES
```

**After (v1.0):**

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    prompt: |
      Analyze PR #${{ github.event.pull_request.number }} for security issues.
      Focus on the changed files in this PR.
```

## Ways to Tag @claude

These examples show how to interact with Claude using comments in PRs and issues. By default, Claude will be triggered anytime you mention `@claude`, but you can customize the exact trigger phrase using the `trigger_phrase` input in the workflow.

Claude will see the full PR context, including any comments.

### Ask Questions

Add a comment to a PR or issue:

```
@claude What does this function do and how could we improve it?
```

Claude will analyze the code and provide a detailed explanation with suggestions.

### Request Fixes

Ask Claude to implement specific changes:

```
@claude Can you add error handling to this function?
```

### Code Review

Get a thorough review:

```
@claude Please review this PR and suggest improvements
```

Claude will analyze the changes and provide feedback.

### Fix Bugs from Screenshots

Upload a screenshot of a bug and ask Claude to fix it:

```
@claude Here's a screenshot of a bug I'm seeing [upload screenshot]. Can you fix it?
```

Claude can see and analyze images, making it easy to fix visual bugs or UI issues.

## Issue Metadata Management

Claude can automatically manage issue labels and types based on the content and context of issues. This feature helps maintain consistent issue classification without manual intervention.

### Enable Metadata Management

```yaml
with:
  manage_issue_metadata: true
  metadata_types_enabled: true # Enable issue types (requires organization feature)
```

### How It Works

**Initial Analysis (Step 2a - Before Starting Work):**

For NEW issues (first time being worked on):

- Claude analyzes the issue content when first triggered
- Fetches available repository labels and organization issue types
- Performs full categorization:
  - Issue type (bug, feature, documentation, enhancement)
  - Priority level (high, medium, low, critical)
  - Technical areas (frontend, backend, API, database)
  - Complexity indicators (small, medium, large)
- Adds "in-progress" status label to indicate work has started
- Applies all relevant labels and sets issue type

For EXISTING issues (subsequent executions):

- Checks current labels to identify it's been worked on before
- Only updates status labels:
  - Removes previous status (ready, blocked, needs-review)
  - Adds "in-progress" to indicate work has resumed
- Preserves all categorization labels unchanged

**Final Update (Step 4a - After Completing Work):**

- Reviews actual work completed
- Updates status labels:
  - Removes "in-progress"
  - Adds final status (resolved, needs-review, blocked)
- May adjust classification if scope changed:
  - Update complexity based on actual effort
  - Add component labels for modified areas
  - Change type if nature evolved during implementation


### Label Limitations

- **No Label Creation**: Claude can only use existing repository labels
- **Missing Labels**: Will document and use closest alternatives
- **Status Labels**: Ensure common status labels exist in your repository:
  - `in-progress`, `investigating`, `resolved`, `needs-review`, `blocked`, `ready`

### Requirements

- **Labels**: Works with any repository (uses existing labels only)
- **Issue Types**: Requires organization-level issue types feature to be enabled
- **Permissions**: Requires `issues: write` permission in workflow

### Example Workflow

1. **First Execution on New Issue**:

   - Step 2a: Full analysis + categorization + set "in-progress"
   - Work on implementation
   - Step 4a: Update to "resolved" or "needs-review"

2. **Second Execution on Same Issue** (e.g., addressing review feedback):
   - Step 2a: Only change status from "needs-review" to "in-progress"
   - Work on changes
   - Step 4a: Update back to "resolved"

### Example Output

Claude will document its metadata decisions in comments:

```
### Initial Issue Classification (New Issue)
Based on the issue description, I've applied the following labels:
- `bug` - This appears to be a defect in existing functionality
- `frontend` - The issue affects the user interface
- `medium-priority` - Standard bug requiring attention
- `size-small` - Should be a straightforward fix
- `in-progress` - Starting work on this issue

### Status Update (Existing Issue)
Updated issue status:
- Removed `needs-review` - Previous review completed
- Added `in-progress` - Resuming work on feedback

### Final Metadata Update
After implementing the fix, I've updated the labels:
- Removed `in-progress` - Work completed
- Added `resolved` - Issue has been addressed
- Added `css` - The fix involved CSS changes
```
