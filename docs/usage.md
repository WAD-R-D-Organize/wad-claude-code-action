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
      - uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # Or use OAuth token instead:
          # claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          # Optional: set execution mode (default: tag)
          # mode: "tag"
          # Optional: add custom trigger phrase (default: @claude)
          # trigger_phrase: "/claude"
          # Optional: add assignee trigger for issues
          # assignee_trigger: "claude"
          # Optional: add label trigger for issues
          # label_trigger: "claude"
          # Optional: add custom environment variables (YAML format)
          # claude_env: |
          #   NODE_ENV: test
          #   DEBUG: true
          #   API_URL: https://api.example.com
          # Optional: limit the number of conversation turns
          # max_turns: "5"
          # Optional: grant additional permissions (requires corresponding GitHub token permissions)
          # additional_permissions: |
          #   actions: read
          # Optional: allow bot users to trigger the action
          # allowed_bots: "dependabot[bot],renovate[bot]"
```

## Inputs

| Input                          | Description                                                                                                                           | Required | Default   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- |
| `mode`                         | Execution mode: 'tag' (default - triggered by mentions/assignments), 'agent' (for automation), 'experimental-review' (for PR reviews) | No       | `tag`     |
| `anthropic_api_key`            | Anthropic API key (required for direct API, not needed for Bedrock/Vertex)                                                            | No\*     | -         |
| `claude_code_oauth_token`      | Claude Code OAuth token (alternative to anthropic_api_key)                                                                            | No\*     | -         |
| `direct_prompt`                | Direct prompt for Claude to execute automatically without needing a trigger (for automated workflows)                                 | No       | -         |
| `override_prompt`              | Complete replacement of Claude's prompt with custom template (supports variable substitution)                                         | No       | -         |
| `base_branch`                  | The base branch to use for creating new branches (e.g., 'main', 'develop')                                                            | No       | -         |
| `max_turns`                    | Maximum number of conversation turns Claude can take (limits back-and-forth exchanges)                                                | No       | -         |
| `timeout_minutes`              | Timeout in minutes for execution                                                                                                      | No       | `30`      |
| `use_sticky_comment`           | Use just one comment to deliver PR comments (only applies for pull_request event workflows)                                           | No       | `false`   |
| `github_token`                 | GitHub token for Claude to operate with. **Only include this if you're connecting a custom GitHub app of your own!**                  | No       | -         |
| `model`                        | Model to use (provider-specific format required for Bedrock/Vertex)                                                                   | No       | -         |
| `fallback_model`               | Enable automatic fallback to specified model when primary model is unavailable                                                        | No       | -         |
| `anthropic_model`              | **DEPRECATED**: Use `model` instead. Kept for backward compatibility.                                                                 | No       | -         |
| `use_bedrock`                  | Use Amazon Bedrock with OIDC authentication instead of direct Anthropic API                                                           | No       | `false`   |
| `use_vertex`                   | Use Google Vertex AI with OIDC authentication instead of direct Anthropic API                                                         | No       | `false`   |
| `allowed_tools`                | Additional tools for Claude to use (the base GitHub tools will always be included)                                                    | No       | ""        |
| `disallowed_tools`             | Tools that Claude should never use                                                                                                    | No       | ""        |
| `custom_instructions`          | Additional custom instructions to include in the prompt for Claude                                                                    | No       | ""        |
| `mcp_config`                   | Additional MCP configuration (JSON string) that merges with the built-in GitHub MCP servers                                           | No       | ""        |
| `assignee_trigger`             | The assignee username that triggers the action (e.g. @claude). Only used for issue assignment                                         | No       | -         |
| `label_trigger`                | The label name that triggers the action when applied to an issue (e.g. "claude")                                                      | No       | -         |
| `trigger_phrase`               | The trigger phrase to look for in comments, issue/PR bodies, and issue titles                                                         | No       | `@claude` |
| `branch_prefix`                | The prefix to use for Claude branches (defaults to 'claude/', use 'claude-' for dash format)                                          | No       | `claude/` |
| `claude_env`                   | Custom environment variables to pass to Claude Code execution (YAML format)                                                           | No       | ""        |
| `settings`                     | Claude Code settings as JSON string or path to settings JSON file                                                                     | No       | ""        |
| `additional_permissions`       | Additional permissions to enable. Currently supports 'actions: read' for viewing workflow results                                     | No       | ""        |
| `experimental_allowed_domains` | Restrict network access to these domains only (newline-separated).                                                                    | No       | ""        |
| `use_commit_signing`           | Enable commit signing using GitHub's commit signature verification. When false, Claude uses standard git commands                     | No       | `false`   |
| `enable_submodule_branches`    | Enable automatic creation of corresponding branches in git submodules                                                                  | No       | `true`    |
| `branch_push_strategy`         | Strategy for pushing branches: 'immediate' (push after creation), 'deferred' (push on first commit), 'auto' (smart selection)        | No       | `auto`    |
| `branch_reuse_strategy`        | Strategy for branch reuse: 'always_new' (always create), 'smart_reuse' (reuse unless explicit request), 'always_reuse' (always reuse) | No       | `smart_reuse` |
| `allowed_bots`                 | Comma-separated list of allowed bot usernames, or '\*' to allow all bots. Empty string (default) allows no bots                       | No       | ""        |

\*Required when using direct Anthropic API (default and when not using Bedrock or Vertex)

> **Note**: This action is currently in beta. Features and APIs may change as we continue to improve the integration.

## Ways to Tag @claude

These examples show how to interact with Claude using comments in PRs and issues. By default, Claude will be triggered anytime you mention `@claude`, but you can customize the exact trigger phrase using the `trigger_phrase` input in the workflow.

Claude will see the full PR context, including any comments.

### Ask Questions

Add a comment to a PR or issue:

```text
@claude What does this function do and how could we improve it?
```

Claude will analyze the code and provide a detailed explanation with suggestions.

### Request Fixes

Ask Claude to implement specific changes:

```text
@claude Can you add error handling to this function?
```

### Code Review

Get a thorough review:

```text
@claude Please review this PR and suggest improvements
```

Claude will analyze the changes and provide feedback.

### Fix Bugs from Screenshots

Upload a screenshot of a bug and ask Claude to fix it:

```text
@claude Here's a screenshot of a bug I'm seeing [upload screenshot]. Can you fix it?
```

Claude can see and analyze images, making it easy to fix visual bugs or UI issues.

## Branch Management

Claude Code Action provides intelligent branch management to optimize your development workflow and reduce branch clutter.

### Branch Reuse Strategies

Configure how Claude handles branch creation and reuse:

#### `smart_reuse` (Default - Recommended)

Claude automatically detects when you want to continue work on an existing branch vs. create a new one:

```yaml
# In your workflow file
- uses: anthropics/claude-code-action@v1
  with:
    branch_reuse_strategy: smart_reuse  # Default behavior
```

**Will reuse existing branches:**

- "@claude can you also fix the logging issue?"
- "@claude continue working on this feature"
- "@claude 繼續這個工作" (Chinese)

**Will create new branches:**

- "@claude create a new branch for the authentication feature"  
- "@claude start a separate branch for this task"
- "@claude 新建分支來處理這個問題" (Chinese)

#### `always_new` (Traditional)

Always creates new branches (pre-v1.0 behavior):

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    branch_reuse_strategy: always_new
```

#### `always_reuse` (Aggressive Consolidation)

Always tries to reuse existing branches when available:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    branch_reuse_strategy: always_reuse
```

### Branch Push Strategies

Control when branches are pushed to remote:

#### `auto` (Default - Recommended)

Smart selection based on context (commit signing, etc.):

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    branch_push_strategy: auto  # Default behavior
```

#### `immediate`

Push branches immediately after creation:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    branch_push_strategy: immediate
```

#### `deferred`

Push branches only when first commit is made:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    branch_push_strategy: deferred
```

### Submodule Support

Enable automatic branch management in git submodules:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    enable_submodule_branches: true    # Default: true
    branch_reuse_strategy: smart_reuse # Applies to submodules too
    branch_push_strategy: auto         # Coordinates with submodules
```

When enabled:

- Claude automatically creates corresponding branches in submodules
- Branch reuse logic applies to both main repository and submodules
- Push strategies are coordinated across repositories

### Complete Branch Management Example

```yaml
name: Claude with Advanced Branch Management
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, assigned]

jobs:
  claude:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # Required for branch operations
      pull-requests: write   # Required for PR creation
      issues: write         # Required for commenting
      id-token: write       # Required for OIDC authentication
    
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive  # Required if using submodules
          fetch-depth: 50        # Sufficient for branch comparison
      
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          
          # Branch Management Configuration
          branch_reuse_strategy: smart_reuse   # Intelligent reuse
          branch_push_strategy: auto           # Smart push timing
          enable_submodule_branches: true      # Support submodules
          
          # Branch Naming
          branch_prefix: "claude/"             # Consistent naming
          base_branch: main                    # Base for new branches
          
          # Additional Settings
          use_commit_signing: true             # Enable signed commits
```

For more detailed information and examples, see the [Branch Reuse Guide](./BRANCH_REUSE_GUIDE.md).
