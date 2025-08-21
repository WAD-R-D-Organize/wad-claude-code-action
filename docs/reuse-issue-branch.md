# Reuse Issue Branch Feature

## 概述

此功能允許在 Tag 模式下重用現有的 Issue 分支，避免每次觸發 Claude 時都創建新的分支。

## 功能特點

### 1. 自動分支檢測
- 在處理 Issue 時，檢查是否已有相同 Issue 號碼的分支
- 分支命名模式：`{branchPrefix}issue-{issueNumber}-*`
- 例如：`claude/issue-123-20250114-1430`

### 2. 分支重用邏輯
- **找到現有分支**：直接 checkout 該分支繼續工作
- **沒有現有分支**：按照原有邏輯創建新分支
- 排序規則：按分支名稱降序排列，選擇最新的分支

### 3. 子模組支援
- 主倉庫重用分支時，子模組也會嘗試使用相同名稱的分支
- 若子模組沒有對應分支，則創建新分支
- 保持主倉庫和子模組的分支同步

## 使用方式

### 在 GitHub Action 中啟用

```yaml
- name: Claude Code
  uses: anthropic-ai/claude-code-action@main
  with:
    reuse_issue_branch: true  # 啟用分支重用功能
    branch_prefix: "claude/"
    # 其他配置...
```

### 配置參數

| 參數 | 類型 | 預設值 | 描述 |
|------|------|--------|------|
| `reuse_issue_branch` | boolean | `false` | 啟用 Issue 分支重用功能 |

## 工作流程

### 1. Issue 首次觸發
```
1. 用戶在 Issue #123 中 @claude
2. 檢查是否有 claude/issue-123-* 分支 ❌
3. 創建新分支：claude/issue-123-20250114-1430
4. Claude 開始處理
```

### 2. Issue 後續觸發
```
1. 用戶在 Issue #123 中再次 @claude
2. 檢查是否有 claude/issue-123-* 分支 ✅
3. 找到：claude/issue-123-20250114-1430
4. 重用該分支，繼續在上面工作
```

## 技術實現

### 主要修改檔案

1. **action.yml** - 新增 `reuse_issue_branch` 參數
2. **src/github/context.ts** - 添加參數解析
3. **src/github/operations/branch.ts** - 實現分支檢測和重用邏輯
4. **src/github/operations/submodule.ts** - 實現子模組分支處理

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

#### `checkoutOrCreateSubmoduleBranches()`
```typescript
export async function checkoutOrCreateSubmoduleBranches(
  branchName: string,
  submodules: SubmoduleInfo[],
  existingBranch: string,
): Promise<SubmoduleBranchInfo[]>
```

## 相容性

- **向後相容**：預設為 `false`，不影響現有工作流程
- **PR 模式**：此功能僅影響 Issue，PR 模式行為不變
- **子模組**：支援有/無子模組的專案

## 注意事項

1. **分支命名**：必須遵循 `{branchPrefix}issue-{number}-*` 模式
2. **權限**：需要 repository 的讀取權限來列出分支
3. **清理**：舊分支需要手動清理（可考慮後續添加自動清理功能）
4. **衝突處理**：重用分支時可能遇到合併衝突，需要手動解決

## 範例使用情境

### 情境 1：迭代開發
```
Issue #123: "添加用戶認證功能"
1. 第一次 @claude → 創建 claude/issue-123-20250114-1000
2. Claude 實現基本認證邏輯
3. 用戶反饋需要調整
4. 第二次 @claude → 重用 claude/issue-123-20250114-1000
5. Claude 在同一分支上修改和完善
```

### 情境 2：多階段任務
```
Issue #456: "重構數據庫層"
1. 階段 1：@claude 分析現有代碼 → claude/issue-456-20250114-1100
2. 階段 2：@claude 實現新的數據庫抽象 → 重用同一分支
3. 階段 3：@claude 更新測試 → 重用同一分支
4. 最終：一個 PR 包含完整的重構
```