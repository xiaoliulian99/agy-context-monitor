# Antigravity Context Monitor

轻量、独立、本地运行的 Antigravity Context companion。圆环画在 **Antigravity 窗口右下角**（应用内 HUD），不是独立系统浮窗。RPC/计算在 `src/main.js --watch`，asar 只注入 HUD + 启动 bootstrap。

## 运行

```bat
node src/main.js
node src/main.js --watch
node tests/context.test.js
node injector/install.js
node injector/install.js --uninstall
node injector/install.js --check
```

注入会关闭 Antigravity 以解锁 `app.asar`，然后把 HUD 追加进 `dist/preload.js`，把 monitor 启动器追加进 `dist/main.js`。不碰汉化包的 `app.asar.bak`，自有备份为 `app.asar.agy-context.bak`。HUD 读 `%LOCALAPPDATA%\agy-context-monitor\status.json`。

需要本机已安装 Node.js。POC 无第三方依赖。

## 已验证事实 / VERIFIED

以本机 Google Antigravity Desktop **2.11.0** 实机为准。

| 项 | 值 |
|---|---|
| 安装目录 | `C:\Users\12704\AppData\Local\Programs\antigravity` |
| 主程序 | `Antigravity.exe` FileVersion `2.11.0` |
| ASAR | `resources\app.asar`；`package.json` name=`antigravity` version=`2.11.0` main=`dist/main.js` |
| ASAR 备份 | `resources\app.asar.bak` 存在（汉化包已注入过） |
| Language Server 二进制 | `resources\bin\language_server.exe` |
| 用户数据 | `%APPDATA%\Antigravity` |
| 活体进程名 | `language_server.exe`（不是 `language_server_windows.exe`） |
| LS 启动参数 | `--standalone --override_ide_name antigravity --subclient_type hub --override_ide_version 2.11.0 --https_server_port 0 --csrf_token <uuid> --app_data_dir antigravity`，**无** `--workspace_id` |
| 活体端口 | 一个 HTTPS（本机 65370）、一个 HTTP（本机 65371）。端口每次启动变化。 |
| RPC | Connect-RPC JSON：`POST /exa.language_server_pb.LanguageServerService/<Method>`，header `Connect-Protocol-Version: 1` + `x-codeium-csrf-token` |
| 探测方法 | `GetUnleashData` 返回 2xx JSON 即认为端口有效 |
| Session 列表 | `GetAllCascadeTrajectories` → `trajectorySummaries[cascadeId]`，字段含 `summary/stepCount/status/lastModifiedTime/trajectoryId/workspaces[].workspaceFolderAbsoluteUri` |
| 状态枚举 | `CASCADE_RUN_STATUS_IDLE` / `CASCADE_RUN_STATUS_RUNNING` |
| Steps | `GetCascadeTrajectorySteps { cascadeId, startIndex, endIndex }` |
| Step 类型 | `CORTEX_STEP_TYPE_USER_INPUT` / `PLANNER_RESPONSE` / `CHECKPOINT` / `VIEW_FILE` / `CODE_ACTION` / `SYSTEM_MESSAGE` 等 |
| 用户文本 | `step.userInput.userResponse` |
| 模型回复 | `step.plannerResponse.response` + `thinking` + `toolCalls[].argumentsJson` |
| 2.11.0 token 真值 | `PLANNER_RESPONSE.metadata.modelUsage.{inputTokens,outputTokens,cacheReadTokens,thinkingOutputTokens,responseOutputTokens}` |
| Context Limit | `GetAvailableModels` → `modelExperiments.experiments.CASCADE_USE_EXPERIMENT_CHECKPOINTER.stringValue.max_token_limit`。活体：Gemini 3.8 Flash High `256000`，Gemini 3.1 Pro `128000`，Claude Sonnet 4.6 `160000` |
| 模型显示名 | `GetUserStatus` → `userStatus.cascadeModelConfigData.clientModelConfigs[].label` |
| ASAR 注入目标 | `dist/preload.js`、`dist/menu.js`、`dist/tray.js`、`dist/loadingOverlay.js`、`dist/updater.js` |

## 与参考项目的差异 / 必须以 2.11.0 为准

1. **Language Server 进程名**  
   参考项目 `discovery.ts` 在 Windows 上匹配 `language_server_windows`。本机 2.11.0 Desktop 进程名是 `language_server.exe`，命令行含 `antigravity`。POC 匹配 `language_server` + `antigravity`。

2. **Checkpoint 没有 `modelUsage`**  
   参考项目把 `CORTEX_STEP_TYPE_CHECKPOINT.metadata.modelUsage` 当准确 baseline。本机活体 checkpoint 的 metadata 只有 `createdAt/retryInfos/executionId/internalMetadata` 等。`retryInfos[].usage` 是 checkpoint 摘要模型（约 120/485 tokens），不能当会话 Context。  
   真值在后续 `PLANNER_RESPONSE.metadata.modelUsage`。

3. **必须计入 cacheReadTokens**  
   Gemini 请求里 `inputTokens` 经常只是未命中缓存的增量，`cacheReadTokens` 才是缓存前缀。活体最后一轮：`input=4568` + `cache=56846` ≈ 61k prompt。若只加 `inputTokens+outputTokens` 会严重低估。

4. **GetCascadeTrajectorySteps 分页**  
   对本机当前 session，`startIndex=0,endIndex=50` 一次返回全部 91 步。参考项目按 50 步分批。POC 先一次拉 `0..stepCount`，空结果再分批。

5. **GetUserStatus 不能当 Context Limit**  
   `planInfo.maxNumChatInputTokens` 活体为 `16384`，这是聊天输入上限，不是模型 Context Window。Limit 走 `GetAvailableModels` checkpointer。

## ASAR 注入结论（第五阶段再用）

来源：`qqxpee/antigravity2-cn` 的 `localization_engine.js`。

- 定位：Windows 注册表 Uninstall + `%LOCALAPPDATA%\Programs\antigravity`
- 备份：首次复制 `app.asar` → `app.asar.bak`；卸载用 bak 覆盖并删除 bak
- 解包/重包：`npx -y @electron/asar extract|pack`，临时目录 `_temp_asar`
- 安装会 `taskkill /f /im Antigravity.exe`
- **preload.js 不适合启动 monitor.exe**：它注入的是 renderer 侧 MutationObserver 翻译 IIFE
- **推荐注入点（UNVERIFIED until Phase 5）**：`dist/main.js`（Electron main，`package.json.main`）。Bootstrap 只负责 spawn 独立 `agy-context-monitor.exe`，不要把 RPC/UI 塞进 asar

本机 `app.asar` 已含汉化签名块（21.5MB vs bak 4.5MB）。Monitor 安装必须与汉化共存：先备份当前 asar，或在已注入文件上做增量插入，禁止无脑用官方 bak 覆盖掉用户汉化。

## Context 公式（POC）

```
promptTokens = modelUsage.inputTokens + modelUsage.cacheReadTokens
baseline     = 最后一条带 modelUsage 的步骤（优先 CHECKPOINT.modelUsage，2.11.0 上通常是最后一条 PLANNER_RESPONSE）
delta        = baseline 之后 USER_INPUT / PLANNER_RESPONSE 的字符估算
contextUsed  = promptTokens + outputTokens + delta
limit        = GetAvailableModels checkpointer.max_token_limit
```

Compression / Undo（2.11.0 适配）：

- 主检测：连续带 `modelUsage` 的步骤（通常是 PLANNER_RESPONSE）比较 `promptTokens`，下降 > 5000 视为压缩。不用 `CHECKPOINT.retryInfos.usage`。
- 降级：同一 session 跨轮询 `contextUsed` 下降 > 5000，且 `stepCount` 未减少。
- Undo：同一 session `stepCount` 下降 → Rewind，清缓存并重建 baseline，**不**标成 Compression。

字符估算（来自参考项目 `tracker.ts`，源码确认后再实现）：

- ASCII `chars/4`
- 非 ASCII `chars/1.5`
- 文本字段：`userInput.userResponse`，`plannerResponse.response + thinking + toolCalls[].argumentsJson`
- 父对象缺失才 fallback：user 500 / planner 800
- 完全没有 modelUsage 时才加 `SYSTEM_PROMPT_OVERHEAD = 10000`

## 参考项目哪些直接复用 / 要改 / 不做

可复用：Connect-RPC 路径与 CSRF header、GetAllCascadeTrajectories / GetCascadeTrajectorySteps / GetUserStatus / GetAvailableModels、RUNNING 优先、字符估算、压缩检测思路（checkpoint input 下降 > 5000）、指数退避。

必须改造：Windows 进程名、cacheReadTokens、checkpoint 无 modelUsage 时的 baseline、Desktop 无 VS Code workspace URI 时用最近 RUNNING/最近修改 session。

明确不做：WebView Dashboard、配额/费用/日历、账号、数据库、云同步。

## 已知限制

- 当前活体 session 全是 `IDLE`。RUNNING 跟随逻辑已按参考项目写好，但尚未在用户正在流式输出时实机看到 RUNNING。标记为 **PARTIALLY VERIFIED**。
- `--watch` 已实现：LS/RPC 失败指数退避（发现上限 15s，RPC 上限 60s）、Antigravity 关闭后等待重启、Session 切换跟随、未变化不刷屏。关闭/切换的实机回归仍待用户操作验证。
- Compression / Undo 逻辑已实现并用构造数据单测覆盖。活体长会话压缩/撤销仍待用户操作验证（**PARTIALLY VERIFIED**）。
- `GetCascadeTrajectorySteps` 是否永远忽略分页：**PARTIALLY VERIFIED**（仅一个 91-step session）。
- HUD 注入 `dist/preload.js`（右下 60px 圆环）；monitor 由 `dist/main.js` 末尾 bootstrap `spawn(node, [src/main.js, --watch])`。preload 不做 spawn。
- 注入后需重启 Antigravity。更新覆盖 `app.asar` 后 bootstrap 会消失，`--check` 可检测，需重新 `install.js`。
- 活体注入后的圆环显示仍待重启验证。

## 阶段状态

1. Research / Reverse Engineering：完成（本文）
2. CLI POC：完成（`node src/main.js` 实机 62.2k/256k）
3. 实时监控 + Compression/Undo：完成（活体压缩/撤销仍待操作验证）
4. 窗口右下 HUD：`injector/bootstrap/hud.js` 已写
5. ASAR 注入：`injector/install.js`（HUD + 自动启动 watch）
