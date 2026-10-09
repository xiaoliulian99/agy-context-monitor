# AGENTS.md

Windows 上给 Antigravity Desktop 用的 Context 圆环。监控是独立 Node 进程；HUD 注入在 `app.asar` 里，画在输入框麦克风左侧。

当前版本、备份和未提交改动以 `交接.md` 为准，不要在这里再写一份状态。

## 怎么跑

```bat
双击注入圆环.bat
双击卸载圆环.bat
node injector/install.js --check
npm test
```

依赖系统 Node LTS。无 `node_modules`。第一次注入会 `npx @electron/asar`。

## 技术栈

Node.js。入口 `src/main.js`，注入 `injector/install.js`，HUD 在 `injector/bootstrap/hud.js`。

## 约定

- 不要删本仓库。bootstrap 写死了 `src/main.js` 的绝对路径。
- 不要动 Antigravity 的 `resources\app.asar.bak`。圆环只用 `app.asar.agy-context.bak`。
- 注入会结束 `Antigravity.exe`。只读确认用 `--check`。
- 双击 bat 维持 `chcp 65001`（仅一次）且保持 ASCII；中文确认与逐条慢显在 `install.js` 里实时输出，不再把整份日志 `type` 回屏幕。
- macOS 用 `双击注入圆环.command`。状态目录是 `~/Library/Application Support/agy-context-monitor`。写回 asar 后要 `codesign`；真机能否打开尚未验证。不要在 Windows 上改掉现有 bat。
- `rpc.js` 的 `ideVersion` 仍是 `2.11.0`。不要顺手改成安装版本，除非同时改探针和测试。
