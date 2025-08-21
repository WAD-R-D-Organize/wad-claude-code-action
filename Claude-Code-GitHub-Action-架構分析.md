# Claude Code GitHub Action 專案架構分析

## 專案概覽

Claude Code GitHub Action 是一個完整的 GitHub Action 專案，讓 Claude AI 能夠直接與 GitHub 的 Pull Requests 和 Issues 進行互動。該專案採用精心設計的雙階段架構和模組化系統，支援多種執行模式和雲端提供者。

### 核心特性
- **智能觸發**：支援 @claude 提及、issue 指派、標籤等多種觸發方式
- **多模式執行**：Tag 模式、Agent 模式、實驗性審查模式
- **安全認證**：OIDC token 交換和 GitHub App 整合
- **MCP 整合**：多個專用 MCP 服務器提供 GitHub API 訪問
- **多雲支援**：Anthropic API、AWS Bedrock、Google Vertex AI

## 雙階段架構

### 階段一：準備階段 (`src/entrypoints/prepare.ts`)

準備階段負責所有前置作業，包括認證、權限驗證、觸發檢測和初始設定。

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   模式驗證      │ -> │   認證設定      │ -> │   上下文解析    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         v                       v                       v
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   權限檢查      │ -> │   觸發檢測      │ -> │   模式準備      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**主要職責：**
1. 驗證並設定執行模式
2. 通過 OIDC 建立 GitHub 認證
3. 檢查執行者權限
4. 檢測觸發條件
5. 初始化追蹤評論和分支

### 階段二：執行階段 (`base-action/`)

執行階段運行 Claude Code 的核心邏輯，處理與 Claude AI 的實際互動。

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   環境驗證      │ -> │   Claude 設定   │ -> │   提示準備      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         v                       v                       v
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP 配置      │ -> │   Claude 執行   │ -> │   結果處理      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**主要職責：**
1. 驗證必要環境變數
2. 設定 Claude Code 配置
3. 準備輸入提示
4. 執行 Claude 並管理進程
5. 處理輸出和錯誤

## 模式系統深度解析

### Tag 模式 (`src/modes/tag/`)

**設計目標：** 傳統的互動模式，由人類使用者主動觸發

**觸發機制：**
- @claude 提及
- Issue 指派給 @claude
- 添加 "claude" 標籤

**執行流程：**
```
觸發檢測 -> 人類驗證 -> 權限檢查 -> 追蹤評論 -> GitHub資料獲取 -> 分支設定 -> Git配置 -> 提示生成 -> MCP配置
```

**核心特性：**
- 完整的追蹤評論系統，即時顯示執行進度
- 自動分支管理（預設 `claude/` 前綴）
- 豐富的 MCP 服務器配置
- 支援影像下載和處理
- Git 認證和提交簽名

### Agent 模式 (`src/modes/agent/`)

**設計目標：** 自動化執行，適合排程任務和工作流觸發

**觸發機制：**
- `workflow_dispatch` 事件
- `schedule` 事件

**執行流程：**
```
自動觸發 -> 簡化準備 -> 直接提示 -> 最小MCP配置 -> Claude執行
```

**核心特性：**
- 繞過人類驗證和評論追蹤
- 支援 `override_prompt` 和 `direct_prompt`
- 最小化 MCP 配置，專注檔案操作
- 適合 CI/CD 自動化場景

### Experimental Review 模式 (`src/modes/review/`)

**設計目標：** 程式碼審查專用模式，支援行內評論

**觸發機制：**
- Pull Request 相關事件

**執行流程：**
```
PR事件觸發 -> 使用預設Token -> 行內評論配置 -> 審查執行
```

**核心特性：**
- 使用 GitHub Actions 預設 token
- 專用的行內評論 MCP 服務器
- 支援程式碼建議和行內回饋
- 實驗性功能，持續演進中

## GitHub 整合層架構

### 認證系統 (`src/github/token.ts`)

**OIDC Token 交換流程：**
```
GitHub Actions OIDC Token -> Anthropic API 交換 -> GitHub App Token -> API 調用
```

**實作細節：**
1. 獲取 GitHub Actions OIDC token (`core.getIDToken`)
2. 向 Anthropic API 端點交換 App token
3. 使用 App token 進行後續 GitHub API 調用
4. 支援自定義 GitHub token 覆蓋

**安全考量：**
- OIDC token 具有時效性和範圍限制
- App token 在執行完成後自動撤銷
- 支援自定義 GitHub App 配置

### 資料獲取層 (`src/github/data/`)

**GraphQL 查詢架構：**
```
Fetcher -> GraphQL Client -> GitHub API -> 資料格式化 -> Claude 可讀格式
```

**主要元件：**
- **Fetcher (`fetcher.ts`)**：統一的資料獲取介面
- **Formatter (`formatter.ts`)**：將 GitHub 資料轉換為 Claude 友好格式
- **Image Downloader (`utils/image-downloader.ts`)**：處理評論中的影像附件

**獲取資料類型：**
- PR/Issue 基本資訊和時間線
- 檔案變更和 diff 資訊
- 評論、審查和回饋
- 用戶資訊和權限

### 操作層 (`src/github/operations/`)

**分支管理 (`branch.ts`)**：
```
檢查目標分支 -> 建立 Claude 分支 -> 設定上游追蹤 -> 切換工作目錄
```

**評論操作 (`comments/`)**：
- **初始評論 (`create-initial.ts`)**：建立進度追蹤評論
- **更新評論 (`update-claude-comment.ts`)**：即時更新執行狀態
- **分支連結 (`update-with-branch.ts`)**：添加分支和 PR 連結

**Git 配置 (`git-config.ts`)**：
- 設定 Git 用戶資訊
- 配置認證 token
- 處理提交簽名設定

## MCP 服務器架構

### 核心 MCP 服務器

#### 1. GitHub Comment Server (`github-comment-server.ts`)
**用途：** 更新和管理 GitHub 評論
**功能：**
- 更新 Claude 追蹤評論
- 添加執行進度指示器
- 處理評論格式化

#### 2. GitHub File Operations Server (`github-file-ops-server.ts`)
**用途：** 檔案系統操作和提交管理
**功能：**
- 檔案讀寫操作
- Git 提交和推送
- 提交簽名支援
**啟用條件：** `use_commit_signing: true`

#### 3. GitHub Inline Comment Server (`github-inline-comment-server.ts`)
**用途：** PR 行內評論功能
**功能：**
- 建立行內程式碼評論
- 支援建議變更
- 審查工作流整合
**啟用條件：** `experimental-review` 模式

#### 4. GitHub Actions Server (`github-actions-server.ts`)
**用途：** CI/CD 工作流程訪問
**功能：**
- 查看工作流程執行狀態
- 訪問 CI 檢查結果
- 分析構建失敗原因
**啟用條件：** `actions: read` 權限 + PR 上下文

#### 5. GitHub MCP Server (Docker)
**用途：** 完整 GitHub API 訪問
**功能：**
- 全面的 GitHub API 操作
- Repository 管理
- Issue 和 PR 操作
**實作：** Docker 容器化第三方服務器

### MCP 配置動態生成 (`install-mcp-server.ts`)

**配置策略：**
```
基礎配置 -> 模式特定配置 -> 權限檢查 -> 用戶自定義配置 -> 合併輸出
```

**條件性服務器啟用：**
- 依據執行模式選擇性啟用
- 權限驗證決定功能範圍
- 合併用戶提供的額外配置

## 完整執行流程

### 1. GitHub Action 觸發
```
GitHub Event (PR comment, issue assignment, etc.) -> Workflow 啟動
```

### 2. 環境準備階段
```yaml
步驟 1: 安裝 Bun 1.2.11
步驟 2: 安裝專案依賴 (bun install)
步驟 3: 執行準備腳本 (prepare.ts)
```

### 3. 準備階段詳細流程
```
┌─ 模式驗證 ─┐
│ ┌─ tag    │
│ ├─ agent  │ -> 設定驗證
│ └─ review │
└───────────┘
      │
      v
┌─ Token 設定 ─┐
│ ┌─ OIDC交換  │
│ ├─ App Token │ -> 認證建立
│ └─ 自定義Token│
└──────────────┘
      │
      v
┌─ 上下文解析 ─┐
│ ┌─ PR資訊    │
│ ├─ Issue資訊 │ -> 事件處理
│ └─ 自動化事件 │
└──────────────┘
      │
      v
┌─ 權限檢查 ─┐
│ ┌─ 寫入權限 │
│ ├─ 執行者驗證│ -> 安全驗證
│ └─ Bot檢測  │
└────────────┘
      │
      v
┌─ 觸發檢測 ─┐
│ ┌─ @claude  │
│ ├─ 標籤     │ -> 條件評估
│ └─ 指派     │
└────────────┘
      │
      v
┌─ 模式準備 ─┐
│ ┌─ 追蹤評論 │
│ ├─ 資料獲取 │ -> 模式特定邏輯
│ ├─ 分支設定 │
│ └─ MCP配置  │
└────────────┘
```

### 4. 基礎 Action 安裝
```yaml
步驟 4: 安裝 base-action 依賴
步驟 5: 全域安裝 Claude Code
步驟 6: 設定網路限制 (可選)
```

### 5. 執行階段流程
```
┌─ 環境驗證 ─┐
│ ┌─ API Keys │
│ ├─ 必要變數 │ -> 前置檢查
│ └─ 配置驗證 │
└────────────┘
      │
      v
┌─ Claude設定 ─┐
│ ┌─ 設定檔    │
│ ├─ 工具配置  │ -> 系統準備
│ └─ 環境變數  │
└─────────────┘
      │
      v
┌─ 提示準備 ─┐
│ ┌─ 檔案讀取 │
│ ├─ 格式化   │ -> 輸入處理
│ └─ Named Pipe│
└────────────┘
      │
      v
┌─ Claude執行 ─┐
│ ┌─ 進程啟動  │
│ ├─ 流管理    │ -> 核心執行
│ ├─ 超時控制  │
│ └─ 錯誤處理  │
└─────────────┘
```

### 6. Claude 執行細節
```
Named Pipe 建立 -> Claude 進程啟動 -> 進程間通訊 -> 輸出處理 -> 資源清理
```

**技術實作：**
- **Named Pipes (`mkfifo`)**：進程間通訊
- **Stream 處理**：即時輸出和 JSON 格式化
- **進程管理**：優雅的啟動、監控和清理
- **超時控制**：可配置的執行時間限制

### 7. 後處理階段
```yaml
步驟 7: 更新評論連結 (update-comment-link.ts)
步驟 8: 顯示執行報告 (format-turns.ts)
步驟 9: 撤銷 App Token (清理)
```

## 技術實作細節

### Named Pipes IPC 機制
```javascript
// 建立命名管道
await execAsync(`mkfifo "${PIPE_PATH}"`);

// 設定輸入流
const catProcess = spawn("cat", [promptPath]);
const pipeStream = createWriteStream(PIPE_PATH);
catProcess.stdout.pipe(pipeStream);

// 啟動 Claude 進程
const claudeProcess = spawn("claude", claudeArgs, {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ...customEnv }
});

// 連接管道
const pipeProcess = spawn("cat", [PIPE_PATH]);
pipeProcess.stdout.pipe(claudeProcess.stdin);
```

### JSON 串流處理
```javascript
claudeProcess.stdout.on("data", (data) => {
  const lines = data.toString().split("\n");
  lines.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      const prettyJson = JSON.stringify(parsed, null, 2);
      process.stdout.write(prettyJson + "\n");
    } catch (e) {
      process.stdout.write(line + "\n");
    }
  });
});
```

### 進程超時控制
```javascript
const timeoutId = setTimeout(() => {
  console.error(`Claude process timed out after ${timeoutMs / 1000} seconds`);
  claudeProcess.kill("SIGTERM");
  setTimeout(() => claudeProcess.kill("SIGKILL"), 5000);
}, timeoutMs);

claudeProcess.on("close", (code) => {
  clearTimeout(timeoutId);
  resolve(code || 0);
});
```

## 安全機制

### 權限控制系統

**執行者驗證：**
```javascript
// 檢查寫入權限
const response = await octokit.repos.getCollaboratorPermissionLevel({
  owner: repository.owner,
  repo: repository.repo,
  username: actor,
});

const hasWriteAccess = ["admin", "write"].includes(response.data.permission);
```

**人類使用者檢查：**
```javascript
// 確保非機器人觸發
if (actor.endsWith("[bot]")) {
  throw new Error("Bot users cannot trigger Claude actions");
}
```

### Token 管理

**OIDC Token 交換：**
```javascript
// 獲取 OIDC token
const oidcToken = await core.getIDToken("claude-code-github-action");

// 交換 App token
const response = await fetch(
  "https://api.anthropic.com/api/github/github-app-token-exchange",
  {
    method: "POST",
    headers: { Authorization: `Bearer ${oidcToken}` }
  }
);
```

**自動 Token 撤銷：**
```bash
curl -X DELETE \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  ${GITHUB_API_URL}/installation/token
```

### 網路安全

**域名白名單 (實驗性功能)：**
```bash
# 設定網路限制
if [ -n "$EXPERIMENTAL_ALLOWED_DOMAINS" ]; then
  setup-network-restrictions.sh
fi
```

**提供者域名自動檢測：**
- Anthropic API 域名
- AWS Bedrock 端點
- Google Vertex AI 端點

## 錯誤處理和恢復

### 階段性錯誤處理

**準備階段錯誤：**
```javascript
try {
  // 準備邏輯
} catch (error) {
  core.setFailed(`Prepare step failed: ${error.message}`);
  core.setOutput("prepare_error", error.message);
  process.exit(1);
}
```

**執行階段錯誤：**
```javascript
if (exitCode !== 0) {
  core.setOutput("conclusion", "failure");
  // 仍嘗試保存執行日誌以供分析
  if (output) {
    await writeFile(EXECUTION_FILE, processOutput(output));
  }
  process.exit(exitCode);
}
```

### 資源清理

**進程清理：**
```javascript
// 清理所有子進程
try {
  catProcess.kill("SIGTERM");
  pipeProcess.kill("SIGTERM");
} catch (e) {
  // 進程可能已經結束
}

// 清理檔案資源
try {
  await unlink(PIPE_PATH);
} catch (e) {
  // 忽略清理錯誤
}
```

## 擴展性和自定義

### 模式擴展

**新增模式步驟：**
1. 在 `VALID_MODES` 中添加模式名稱
2. 建立模式實作目錄 `src/modes/new-mode/`
3. 實作 `Mode` 介面
4. 在 `registry.ts` 中註冊
5. 更新 `action.yml` 描述

### MCP 服務器自定義

**用戶配置合併：**
```javascript
const mergedConfig = {
  ...baseMcpConfig,
  ...userConfig,
  mcpServers: {
    ...baseMcpConfig.mcpServers,
    ...userConfig.mcpServers
  }
};
```

### 提供者支援

**多雲配置：**
- **Anthropic API**: 直接 API 調用
- **AWS Bedrock**: OIDC + IAM 角色
- **Google Vertex AI**: OIDC + 服務帳戶
- **自定義端點**: 環境變數配置

## 效能優化

### 並行處理

**並行資料獲取：**
```javascript
const [contextData, comments, files] = await Promise.all([
  fetchContext(),
  fetchComments(),
  fetchFiles()
]);
```

### 快取機制

**MCP 服務器快取：**
- Docker 映像快取
- 依賴項目安裝快取
- GitHub API 回應快取 (透過 GraphQL)

### 資源管理

**記憶體最佳化：**
- 串流處理大型輸出
- 分批處理檔案操作
- 及時釋放不需要的資源

## 監控和除錯

### 執行日誌

**詳細日誌記錄：**
```javascript
console.log(`Prompt file size: ${stats.size} bytes`);
console.log(`Custom environment variables: ${envKeys}`);
console.log(`Running Claude with prompt from file: ${promptPath}`);
```

### 錯誤追蹤

**結構化錯誤資訊：**
- 階段標識 (準備/執行)
- 錯誤類型和訊息
- 堆疊追蹤和上下文
- 恢復建議

### 狀態回報

**GitHub 整合：**
- 即時更新追蹤評論
- GitHub Step Summary 報告
- 工作流程狀態連結
- 分支和 PR 連結

---

## 結論

Claude Code GitHub Action 是一個精心設計的企業級專案，展現了現代軟體架構的最佳實踐：

1. **模組化設計**：清晰的責任分離和可擴展架構
2. **安全第一**：全面的權限控制和 token 管理
3. **容錯能力**：強健的錯誤處理和資源清理
4. **使用者體驗**：即時回饋和詳細狀態追蹤
5. **技術創新**：巧妙的 IPC 機制和 MCP 整合

這個架構不僅支援當前的功能需求，也為未來的功能擴展和改進提供了堅實的基礎。