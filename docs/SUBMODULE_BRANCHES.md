# 子模組分支自動化功能

Claude Code GitHub Action 現在支援自動為 Git 子模組建立對應的分支，實現主倉庫和子模組的同步開發。

## 功能概覽

當您在 Tag 模式下觸發 Claude Code 時，系統會：

1. **自動檢測**：檢查倉庫是否包含 Git 子模組
2. **初始化子模組**：確保所有子模組都已正確初始化
3. **建立分支**：為每個子模組建立與主倉庫分支相同名稱的分支
4. **狀態回報**：在追蹤評論中顯示子模組分支建立狀態

## 設定方式

### 基本啟用

在您的 workflow 檔案中加入 `enable_submodule_branches` 參數：

```yaml
- name: Claude Code Action
  uses: anthropics/claude-code-github-action@v1
  with:
    enable_submodule_branches: true # 預設為 true
    branch_push_strategy: auto # 推送策略：immediate、deferred 或 auto
    # 其他參數...
```

### 分支推送策略配置

您可以選擇不同的分支推送策略：

```yaml
- name: Claude Code Action
  uses: anthropics/claude-code-github-action@v1
  with:
    enable_submodule_branches: true
    branch_push_strategy: immediate # 立即推送
    # 其他參數...
```

#### 推送策略選項

- **`immediate`**：建立分支後立即推送到遠程倉庫
  - 適用於需要立即可見分支的場景
  - 與提交簽名不相容，會自動降級為 deferred 模式
- **`deferred`**：延遲到第一次提交時才推送分支
  - 避免建立空的遠程分支
  - 與提交簽名完全相容
  - 適合需要確保分支有實際變更的場景

- **`auto`**（預設）：根據上下文自動選擇
  - 啟用提交簽名時使用 deferred 模式
  - 其他情況下使用 immediate 模式

### 停用子模組分支功能

如果您不希望 Claude 處理子模組分支，可以停用此功能：

```yaml
- name: Claude Code Action
  uses: anthropics/claude-code-github-action@v1
  with:
    enable_submodule_branches: false
    # 其他參數...
```

## 工作流程

### 1. 觸發條件

- 使用 `@claude` 提及或指派 issue
- 系統檢測到 `.gitmodules` 檔案存在

### 2. 分支建立流程

#### Immediate 推送策略

```
主倉庫分支建立 -> 立即推送
    ↓
子模組檢測和初始化
    ↓
並行建立子模組分支 -> 立即推送
    ↓
分支協調和狀態同步
    ↓
更新追蹤評論顯示狀態
```

#### Deferred 推送策略

```
主倉庫分支建立（本地）
    ↓
子模組檢測和初始化
    ↓
並行建立子模組分支（本地）
    ↓
分支協調和智能等待
    ↓
更新追蹤評論顯示狀態
    ↓
首次提交時推送所有分支
```

### 3. 分支命名規則

- 主倉庫：`claude/issue-123-20241201-1030`
- 子模組：`claude/issue-123-20241201-1030`（相同名稱）

## 支援的子模組配置

### .gitmodules 範例

```ini
[submodule "frontend"]
    path = frontend
    url = https://github.com/your-org/frontend.git
    branch = main

[submodule "backend"]
    path = services/backend
    url = https://github.com/your-org/backend.git
    branch = develop
```

### 基礎分支選擇優先順序

1. 用戶指定的 `base_branch` 參數
2. 子模組 `.gitmodules` 中的 `branch` 設定
3. 預設使用 `main` 分支

## 錯誤處理

### 常見錯誤及解決方案

#### 1. 子模組未初始化

```
❌ Submodule path does not exist: /path/to/submodule
```

**解決方案**：確保 `.gitmodules` 檔案正確，子模組 URL 可訪問

#### 2. 權限不足

```
❌ Error creating branch in submodule: Permission denied
```

**解決方案**：確保 GitHub token 有子模組倉庫的寫入權限

#### 3. 網路連線問題

```
❌ Error initializing submodules: Could not connect to remote
```

**解決方案**：檢查子模組 URL 是否正確，網路連線是否正常

### 容錯機制

- **部分失敗不中斷**：即使某些子模組分支建立失敗，主倉庫流程仍會繼續
- **詳細錯誤報告**：失敗的子模組會在追蹤評論中顯示具體錯誤資訊
- **降級處理**：如果子模組功能完全失敗，會回退到僅處理主倉庫

## 追蹤評論格式

成功時的評論顯示：

```markdown
### 📦 Submodule Branches

- **frontend**: Created branch `claude/issue-123-20241201-1030` ✅
- **backend**: Created branch `claude/issue-123-20241201-1030` ⚠️ (already exists)

### ⚠️ Submodule Errors

- **docs**: Permission denied (publickey)
```

## Claude Code 工具支援

系統提供了新的 MCP 工具來處理子模組提交：

### commit_submodule_changes

```typescript
await mcp.commitSubmoduleChanges({
  submoduleChanges: [
    {
      submodulePath: "frontend",
      commitMessage: "Update component styling",
      files: ["src/components/Button.tsx", "src/styles/main.css"],
    },
  ],
  mainRepoCommitMessage: "Update frontend submodule reference",
});
```

## 最佳實踐

### 1. 權限配置

確保 GitHub App 或 token 有以下權限：

- 主倉庫：`contents:write`, `metadata:read`
- 子模組倉庫：`contents:write`, `metadata:read`

### 2. 子模組組織

建議的子模組結構：

```
project/
├── .gitmodules
├── frontend/          # 子模組
├── backend/           # 子模組
└── shared/            # 子模組
    └── utils/
```

### 3. 分支策略

- 為子模組設定明確的預設分支
- 使用一致的分支命名規則
- 定期同步子模組與上游

### 4. CI/CD 整合

在 workflow 中確保子模組正確初始化：

```yaml
steps:
  - name: Checkout with Submodules
    uses: actions/checkout@v4
    with:
      submodules: recursive
      token: ${{ secrets.GITHUB_TOKEN }}
```

## 疑難排解

### 檢查子模組狀態

```bash
# 檢查子模組狀態
git submodule status

# 更新子模組
git submodule update --init --recursive

# 檢查子模組配置
cat .gitmodules
```

### 手動重設子模組

如果子模組狀態異常：

```bash
# 重設子模組
git submodule deinit --all
git submodule update --init --recursive
```

## 限制事項

1. **巢狀子模組**：目前支援一層子模組，深層巢狀可能有問題
2. **私有倉庫**：需要確保適當的認證設定
3. **大量子模組**：超過 10 個子模組可能影響效能
4. **子模組 URL 變更**：需要手動更新 `.gitmodules`

## 範例配置

完整的 workflow 範例：

```yaml
name: Claude Code with Submodules
on:
  issues:
    types: [opened, assigned]
  issue_comment:
    types: [created]

jobs:
  claude-code:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - name: Claude Code Action
        uses: anthropics/claude-code-github-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          enable_submodule_branches: true
          branch_push_strategy: auto
          base_branch: develop
          branch_prefix: "claude/"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
