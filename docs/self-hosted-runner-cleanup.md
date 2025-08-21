# Self-hosted Runner 工作目錄清理指南

本文件說明如何解決 self-hosted runner 在處理子模組時遇到的未追蹤檔案衝突問題，並提供自動化清理方案。

## 問題背景

### Self-hosted Runner vs GitHub-hosted Runner

- **GitHub-hosted runners**：每次 job 都提供全新的乾淨環境
- **Self-hosted runners**：在 jobs 之間**不會自動清理**工作目錄，檔案會持續保留

### 問題場景

當使用 Claude Code Action 的分支重用功能（`reuse_issue_branch: true`）時：

1. **第一次執行**：
   - 建立新分支（如 `claude/issue-78-20250814-1545`）
   - 在子模組中新增檔案（如 README.md）
   - 提交並推送
   - Runner 結束，但工作目錄檔案仍存在

2. **第二次執行**（相同 Issue）：
   - 偵測並重用現有分支
   - 執行 `git checkout <existing-branch>`
   - 執行 `git submodule update --init --recursive`
   - **❌ 錯誤發生**：
     ```
     error: 工作區中下列未追蹤的檔案將會因為簽出動作而被覆蓋：
         README.md
     請在切換分支前移動或刪除。
     正在終止
     fatal: 無法在子模組路徑簽出
     ```

### 錯誤原因

- 主倉庫成功切換到現有分支
- 但子模組目錄中仍有上次執行留下的未追蹤檔案
- `git submodule update` 嘗試將子模組切換到正確的 commit 時，與未追蹤檔案發生衝突

## 解決方案：Runner Hooks

GitHub Actions 提供 Runner Hooks 功能，允許在 job 開始前和結束後執行自訂腳本。

### 可用的 Hook 環境變數

1. **`ACTIONS_RUNNER_HOOK_JOB_STARTED`**：job 開始前執行
2. **`ACTIONS_RUNNER_HOOK_JOB_COMPLETED`**：job 結束後執行

### 實作優勢

- ✅ 自動化清理，無需修改每個 workflow
- ✅ 集中管理清理邏輯
- ✅ 確保每個 job 都有乾淨的環境
- ✅ 解決子模組未追蹤檔案問題

## 實作步驟

### 步驟 1：建立清理腳本

在 runner 伺服器上建立清理腳本（**必須放在 runner 目錄外**）：

```bash
# 切換到 runner 使用者的 home 目錄
cd /home/runner
sudo nano cleanup-workspace.sh
```

#### 基本清理腳本

```bash
#!/bin/bash
set -e

echo "=== Starting post-job cleanup ==="
echo "Current directory: $(pwd)"

# 檢查是否在正確的工作目錄
if [[ "$GITHUB_WORKSPACE" != "" ]]; then
    echo "Cleaning GitHub workspace: $GITHUB_WORKSPACE"
    cd "$GITHUB_WORKSPACE"
    
    # 清理 Git 倉庫（包含子模組）
    if [ -d ".git" ]; then
        echo "Cleaning git repository and submodules..."
        
        # 清理子模組中的未追蹤檔案
        git submodule foreach --recursive 'git clean -ffdx || true' 2>/dev/null || true
        
        # 重置子模組
        git submodule foreach --recursive 'git reset --hard || true' 2>/dev/null || true
        
        # 清理主倉庫
        git clean -ffdx || true
        git reset --hard HEAD || true
        
        echo "✓ Git repository cleaned"
    else
        echo "Not a git repository, skipping git cleanup"
    fi
else
    echo "GITHUB_WORKSPACE not set, skipping cleanup"
fi

echo "=== Post-job cleanup completed ==="
exit 0
```

#### 進階清理腳本（針對特定倉庫）

```bash
#!/bin/bash
set -e

echo "=== Post-job cleanup for repository: $GITHUB_REPOSITORY ==="

# 只清理特定倉庫
if [[ "$GITHUB_REPOSITORY" == "WAD-R-D-Organize/ERP_LTK" ]] || [[ "$GITHUB_REPOSITORY" == "your-org/your-repo" ]]; then
    if [[ "$GITHUB_WORKSPACE" != "" ]] && [ -d "$GITHUB_WORKSPACE" ]; then
        cd "$GITHUB_WORKSPACE"
        
        echo "Cleaning workspace for $GITHUB_REPOSITORY"
        
        # 詳細的清理策略
        if [ -d ".git" ]; then
            # 清理子模組
            echo "Cleaning submodules..."
            git submodule foreach --recursive 'git clean -ffdx' 2>/dev/null || true
            git submodule foreach --recursive 'git reset --hard' 2>/dev/null || true
            
            # 清理主倉庫
            echo "Cleaning main repository..."
            git clean -ffdx || true
            git reset --hard HEAD || true
            
            # 重新初始化子模組（確保狀態一致）
            echo "Re-initializing submodules..."
            git submodule deinit --all -f || true
            git submodule update --init --recursive || true
        fi
        
        echo "✓ Cleaned workspace for $GITHUB_REPOSITORY"
    fi
else
    echo "Skipping cleanup for $GITHUB_REPOSITORY"
fi

exit 0
```

設定執行權限：
```bash
chmod +x /home/runner/cleanup-workspace.sh
```

### 步驟 2：（可選）建立準備腳本

建立 job 開始前的準備腳本：

```bash
cd /home/runner
sudo nano prepare-workspace.sh
```

```bash
#!/bin/bash
set -e

echo "=== Preparing workspace for new job ==="
echo "Repository: $GITHUB_REPOSITORY"
echo "Workspace: $GITHUB_WORKSPACE"

# 確保工作目錄存在且乾淨
if [[ "$GITHUB_WORKSPACE" != "" ]]; then
    mkdir -p "$GITHUB_WORKSPACE"
    cd "$GITHUB_WORKSPACE"
    
    # 檢查是否有殘留檔案
    if [ "$(ls -A 2>/dev/null)" ]; then
        echo "Warning: Workspace not empty, performing cleanup..."
        
        # 如果是 Git 倉庫，用 Git 清理
        if [ -d ".git" ]; then
            git clean -ffdx || true
            git submodule foreach --recursive 'git clean -ffdx' 2>/dev/null || true
        else
            # 否則直接刪除檔案
            rm -rf ./* 2>/dev/null || true
            rm -rf ./.??* 2>/dev/null || true
        fi
        
        echo "✓ Pre-job cleanup completed"
    else
        echo "✓ Workspace already clean"
    fi
fi

echo "=== Workspace preparation completed ==="
exit 0
```

設定執行權限：
```bash
chmod +x /home/runner/prepare-workspace.sh
```

### 步驟 3：設定環境變數

在 runner 目錄中建立或編輯 `.env` 檔案：

```bash
cd /home/runner/actions-runner
nano .env
```

加入以下內容（**必須使用絕對路徑**）：

```bash
# Job 開始前的 hook（可選）
ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/runner/prepare-workspace.sh

# Job 結束後的 hook（清理用）
ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/home/runner/cleanup-workspace.sh
```

### 步驟 4：重啟 Runner 服務

**重要**：修改 `.env` 檔案後必須重啟 runner 才能生效。

#### 如果 runner 作為系統服務運行：

```bash
cd /home/runner/actions-runner

# 停止服務
sudo ./svc.sh stop

# 啟動服務
sudo ./svc.sh start

# 檢查狀態
sudo ./svc.sh status
```

#### 如果是手動執行：

```bash
# 停止 runner (使用 Ctrl+C)
# 然後重新啟動
./run.sh
```

### 步驟 5：驗證設定

執行一個測試 workflow 後，在 GitHub Actions 日誌中應該能看到：

1. **"Set up runner"** 步驟（如果設定了 `ACTIONS_RUNNER_HOOK_JOB_STARTED`）
2. **"Complete runner"** 步驟（顯示清理腳本的輸出）

範例日誌輸出：
```
Complete runner
=== Starting post-job cleanup ===
Current directory: /home/runner/actions-runner/_work/your-repo/your-repo
Cleaning GitHub workspace: /home/runner/actions-runner/_work/your-repo/your-repo
Cleaning git repository and submodules...
✓ Git repository cleaned
=== Post-job cleanup completed ===
```

## 注意事項與最佳實踐

### 🔴 重要注意事項

1. **腳本位置**：腳本檔案**必須**放在 `actions-runner` 目錄外
2. **絕對路徑**：在 `.env` 檔案中**必須**使用腳本的絕對路徑
3. **重啟需求**：修改 `.env` 檔案後**必須**重啟 runner 服務
4. **權限設定**：確保腳本檔案具有執行權限（`chmod +x`）

### 🟡 最佳實踐

1. **錯誤處理**：
   - 使用 `|| true` 避免清理指令失敗導致 job 失敗
   - 使用 `2>/dev/null` 隱藏非關鍵錯誤訊息

2. **條件式清理**：
   - 檢查 `$GITHUB_REPOSITORY` 只清理特定倉庫
   - 檢查 `$GITHUB_WORKSPACE` 確保工作目錄存在

3. **日誌記錄**：
   - 使用 `echo` 輸出清理進度，方便除錯
   - Hook 輸出會顯示在 workflow 日誌中

4. **安全考量**：
   - 避免在腳本中處理敏感資料
   - 使用 `set -e` 確保腳本在錯誤時停止執行

### 🟢 效能優化

```bash
# 針對大型倉庫，可以使用更精細的清理策略
if [[ "$GITHUB_REPOSITORY" == "large-org/large-repo" ]]; then
    # 只清理特定目錄
    find . -name "*.tmp" -delete 2>/dev/null || true
    find . -name "node_modules" -exec rm -rf {} + 2>/dev/null || true
else
    # 一般倉庫使用完整清理
    git clean -ffdx || true
fi
```

## 疑難排解

### 常見問題與解決方法

#### 1. Hook 腳本沒有執行

**症狀**：在 workflow 日誌中看不到 "Set up runner" 或 "Complete runner" 步驟

**解決方法**：
- 檢查 `.env` 檔案路徑是否正確（必須在 `actions-runner` 目錄中）
- 確認腳本路徑使用絕對路徑
- 確認腳本檔案具有執行權限
- 重啟 runner 服務

#### 2. Hook 腳本執行失敗

**症狀**：job 失敗，錯誤訊息顯示 hook 腳本返回非零退出碼

**解決方法**：
```bash
# 在腳本中加入更多錯誤處理
#!/bin/bash
set -e  # 遇到錯誤就停止

# 使用 || true 避免非關鍵命令失敗
git clean -ffdx || true
git submodule foreach --recursive 'git clean -ffdx' 2>/dev/null || true

# 或者暫時停用 set -e 用於除錯
# set +e
# your_command
# set -e
```

#### 3. 權限問題

**症狀**：腳本無法刪除某些檔案

**解決方法**：
```bash
# 在清理腳本中加入權限修復
find . -type f -exec chmod 644 {} + 2>/dev/null || true
find . -type d -exec chmod 755 {} + 2>/dev/null || true
```

#### 4. 子模組仍有衝突

**症狀**：即使設定了 hook，子模組衝突仍然發生

**解決方法**：
```bash
# 更激進的子模組清理策略
git submodule deinit --all -f || true
rm -rf .git/modules/ || true
git submodule update --init --recursive --force || true
```

### 除錯技巧

1. **檢查腳本是否能手動執行**：
   ```bash
   # 設定環境變數模擬 GitHub Actions 環境
   export GITHUB_WORKSPACE="/path/to/your/workspace"
   export GITHUB_REPOSITORY="your-org/your-repo"
   
   # 手動執行腳本
   /home/runner/cleanup-workspace.sh
   ```

2. **查看 runner 日誌**：
   ```bash
   # 如果使用 systemd
   sudo journalctl -u actions.runner.your-org-your-repo.your-runner.service -f
   
   # 或查看 runner 目錄下的日誌檔案
   tail -f /home/runner/actions-runner/_diag/Runner_*.log
   ```

3. **測試腳本語法**：
   ```bash
   bash -n /home/runner/cleanup-workspace.sh
   ```

## 其他解決方案

如果無法使用 Runner Hooks，以下是其他解決方案：

### 方案 A：在 Workflow 中加入清理步驟

```yaml
jobs:
  claude-code-action:
    runs-on: self-hosted
    steps:
      - name: Clean workspace
        run: |
          if [ -d ".git" ]; then
            git clean -ffdx || true
            git submodule foreach --recursive 'git clean -ffdx' || true
            git reset --hard HEAD || true
          fi
        continue-on-error: true
        
      - name: Checkout repository
        uses: actions/checkout@v4
        # ... 其他步驟
```

### 方案 B：修改 Claude Code Action 本身

在 `src/github/operations/submodule.ts` 中修改 `initializeSubmodules` 函數：

```typescript
export async function initializeSubmodules(): Promise<void> {
  try {
    console.log("Initializing and updating submodules...");
    
    // 清理子模組中的未追蹤檔案
    try {
      await $`git submodule foreach --recursive git clean -fd`;
      console.log("✓ Cleaned untracked files in submodules");
    } catch (cleanError) {
      console.log("Warning: Could not clean submodules:", cleanError);
    }
    
    // 使用 --force 參數強制更新子模組
    await $`git submodule update --init --recursive --force`;
    console.log("✓ Submodules initialized and updated");
  } catch (error) {
    console.log("Error during submodule initialization:", error);
    throw error;
  }
}
```

---

**建議採用 Runner Hooks 方案**，因為它提供最乾淨、最自動化的解決方案，無需修改每個 workflow 或程式碼。