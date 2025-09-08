# Issue 管理功能

本指南涵蓋了 Claude Code Action 的 Issue 管理功能，幫助簡化你的開發工作流程：分支重用和自動分配。

## 分支重用功能

`reuse_issue_branch` 功能允許 Claude 重用現有的 Issue 分支，而不是每次觸發時都創建新分支。這對於迭代開發特別有用，你可以將所有與特定 Issue 相關的工作整合到同一個分支上。

### 運作原理

當啟用 `reuse_issue_branch` 時：

1. **首次觸發**：Claude 創建新分支，遵循 `{branch_prefix}issue-{number}-{timestamp}` 格式
2. **後續觸發**：Claude 搜尋符合 `{branch_prefix}issue-{number}-*` 模式的現有分支，並重用最新的分支
3. **分支選擇**：如果存在多個分支，Claude 會選擇時間戳最新的分支（按字母順序降序排列）

### 自動分支檢測

- 在處理 Issue 時，檢查是否已有相同 Issue 號碼的分支
- 分支命名模式：`{branchPrefix}issue-{issueNumber}-*`
- 例如：`claude/issue-123-20250908-1430`

### 分支重用邏輯

- **找到現有分支**：直接 checkout 該分支繼續工作
- **沒有現有分支**：按照原有邏輯創建新分支
- 排序規則：按分支名稱降序排列，選擇最新的分支

### 配置方式

在你的工作流程中添加以下內容：

```yaml
- name: Claude Code
  uses: anthropic-ai/claude-code-action@main
  with:
    # 啟用 Issue 分支重用
    reuse_issue_branch: true
    
    # 配置分支命名（可選）
    branch_prefix: "claude/"
    
    # 其他配置...
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    trigger_phrase: "@claude"
```

### 工作流程範例

考慮 Issue #123 "添加用戶認證" 的情境：

#### 1. Issue 首次觸發
```
1. 用戶留言「@claude 請實作基本登入功能」
2. 檢查是否有 claude/issue-123-* 分支 ❌
3. 創建分支：claude/issue-123-20250908-1430
4. Claude 實作基本登入功能
```

#### 2. Issue 後續觸發
```
1. 用戶留言「@claude 請加入密碼驗證」
2. 檢查是否有 claude/issue-123-* 分支 ✅
3. 找到：claude/issue-123-20250908-1430
4. Claude 在現有分支上添加驗證功能
```

#### 3. 最終結果
- 單一 PR 包含完整的認證功能

### 子模組支援

- 主倉庫重用分支時，子模組也會嘗試使用相同名稱的分支
- 若子模組沒有對應分支，則創建新分支
- 保持主倉庫和子模組的分支同步

### 優點

- **整合變更**：所有 Issue 相關的工作都在同一分支上
- **清晰的 PR 歷史**：每個 Issue 一個分支，而不是多個片段
- **更容易檢視**：檢視者可以在一個地方看到完整的功能開發
- **減少分支混亂**：更少的分支需要管理和清理

## 自動 Issue 分配功能

`auto_assign_issues` 功能會在 Claude 開始處理 Issue 時自動分配使用者。這有助於 Issue 追蹤，並確保擁有權的可見性。

### 運作原理

當啟用 `auto_assign_issues` 時：

1. **Issue 檢測**：Claude 檢測到正在處理 Issue（不包括 PR）
2. **分配對象確定**：如果指定了自訂分配者則使用，否則分配給 Issue 創建者
3. **分配執行**：自動將確定的使用者分配給 Issue
4. **錯誤處理**：分配失敗不會阻止工作流程

### 配置方式

```yaml
- name: Claude Code  
  uses: anthropic-ai/claude-code-action@main
  with:
    # 啟用自動分配
    auto_assign_issues: true
    
    # 可選：指定自訂分配者
    auto_assign_users: "維護者1,維護者2,團隊領導"
    
    # 其他配置...
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 分配邏輯

| 情境 | 分配對象 |
|------|---------|
| 有提供 `auto_assign_users` | 使用指定的使用者 |
| `auto_assign_users` 為空 | 分配給 Issue 創建者 |
| 分配失敗 | 記錄錯誤但繼續工作流程 |

### 使用範例

**情境 1：團隊維護**
```yaml
auto_assign_issues: true
auto_assign_users: "資深開發者,團隊領導"
```
結果：Claude 處理的所有 Issue 都會分配給資深開發者和團隊領導

**情境 2：創建者分配**  
```yaml
auto_assign_issues: true
# 沒有指定 auto_assign_users
```
結果：Issue 會分配回給創建它們的人

**情境 3：停用**
```yaml
auto_assign_issues: false
```
結果：不會進行自動分配

### 優點

- **明確擁有權**：顯示當 Claude 處理 Issue 時誰負責
- **更好的追蹤**：團隊可以看到哪些 Issue 正在被積極處理
- **通知管理**：被分配的使用者會收到進度通知
- **工作流程整合**：與現有的 GitHub Issue 分配工作流程協作

## 組合使用

兩個功能可以無縫地一起使用：

```yaml
name: 具備 Issue 管理的 Claude 助手
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, assigned]

jobs:
  claude-code:
    permissions:
      contents: write
      pull-requests: write
      issues: write
    runs-on: ubuntu-latest
    steps:
      - name: 具備 Issue 管理的 Claude Code
        uses: anthropic-ai/claude-code-action@main
        with:
          # 啟用兩個功能
          reuse_issue_branch: true
          auto_assign_issues: true
          auto_assign_users: "維護者,資深開發者"
          
          # 標準配置
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          trigger_phrase: "@claude"
          branch_prefix: "claude/"
          use_commit_signing: true
```

## 技術實現

### 主要修改檔案

1. **action.yml** - 新增 `reuse_issue_branch`、`auto_assign_issues` 和 `auto_assign_users` 參數
2. **src/github/context.ts** - 添加參數解析
3. **src/github/operations/branch.ts** - 實現分支檢測和重用邏輯
4. **src/github/operations/assignees.ts** - 實現自動分配邏輯
5. **src/modes/tag/index.ts** - 整合到標籤模式

### 核心函數

#### `findExistingIssueBranch()`
```typescript
async function findExistingIssueBranch(
  octokits: Octokits,
  owner: string,
  repo: string,
  entityNumber: number,
  branchPrefix: string,
): Promise<string | null>
```

#### `addIssueAssignees()`
```typescript
export async function addIssueAssignees(
  octokit: Octokit,
  context: ParsedGitHubContext,
  assignees: string[],
): Promise<void>
```

#### `getAssignees()`
```typescript
export function getAssignees(context: ParsedGitHubContext): string[]
```

## 相容性

- **向後相容**：兩個功能預設都為 `false`，不會影響現有工作流程
- **PR 行為**：`reuse_issue_branch` 只影響 Issue，PR 處理保持不變
- **分配範圍**：`auto_assign_issues` 只適用於 Issue，不適用於 PR
- **子模組支援**：分支重用在啟用子模組處理時能正常運作

## 範例使用情境

### 情境 1：迭代開發
```
Issue #123: "添加用戶認證功能"
1. 第一次 @claude → 創建 claude/issue-123-20250908-1000
2. Claude 實現基本認證邏輯
3. 用戶反饋需要調整
4. 第二次 @claude → 重用 claude/issue-123-20250908-1000
5. Claude 在同一分支上修改和完善
```

### 情境 2：多階段任務
```
Issue #456: "重構資料庫層"
1. 階段 1：@claude 分析現有程式碼 → claude/issue-456-20250908-1100
2. 階段 2：@claude 實現新的資料庫抽象 → 重用同一分支
3. 階段 3：@claude 更新測試 → 重用同一分支
4. 最終：一個 PR 包含完整的重構
```

## 故障排除

### 分支重用問題

**問題**：Claude 創建新分支而不是重用現有分支
- **檢查**：確保設定了 `reuse_issue_branch: true`
- **驗證**：分支命名遵循預期模式
- **除錯**：在 action 日誌中尋找「Searching for existing branches」

**問題**：選擇了錯誤的分支進行重用
- **原因**：存在多個具有不同時間戳的分支
- **解決方案**：Claude 會選擇字母順序最晚的分支名稱

### 分配問題

**問題**：使用者沒有被分配到 Issue
- **檢查**：確保設定了 `auto_assign_issues: true`
- **權限**：驗證 action 具有 `issues: write` 權限
- **使用者**：確認指定的使用者具有倉庫存取權

**問題**：分配失敗並出現權限錯誤
- **解決方案**：檢查 `auto_assign_users` 中的使用者是否為有效的倉庫協作者
- **替代方案**：從清單中移除無效的使用者

## 注意事項

### 分支重用
1. **分支命名**：必須遵循 `{branchPrefix}issue-{number}-*` 模式
2. **權限**：需要 repository 的讀取權限來列出分支
3. **清理**：舊分支需要手動清理（可考慮後續添加自動清理功能）
4. **衝突處理**：重用分支時可能遇到合併衝突，需要手動解決

### 自動分配
1. **使用者驗證**：確保 `auto_assign_users` 中的所有使用者都是有效的協作者
2. **權限要求**：需要 `issues: write` 權限
3. **失敗處理**：分配失敗不會中斷工作流程，但會記錄錯誤

## 參數參考

| 參數 | 描述 | 必需 | 預設值 |
|------|------|------|--------|
| `reuse_issue_branch` | 在標籤模式下，檢查並重用現有的 Issue 分支，而不是創建新分支 | 否 | `false` |
| `auto_assign_issues` | Claude 開始工作時自動分配使用者到 Issue | 否 | `false` |
| `auto_assign_users` | 要分配到 Issue 的使用者名稱清單，以逗號分隔（如果未提供，將使用 Issue 創建者） | 否 | `""` |

## 範例

請查看 `examples/` 目錄中的完整工作流程範例：

- [`examples/reuse-issue-branch-example.yml`](../examples/reuse-issue-branch-example.yml) - 分支重用配置
- [`examples/auto-assign-example.yml`](../examples/auto-assign-example.yml) - 自動分配設定
- [`examples/feature-test-example.yml`](../examples/feature-test-example.yml) - 組合使用範例