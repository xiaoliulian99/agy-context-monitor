# Antigravity Context Monitor

给 **Antigravity Desktop 2.11.0（Windows）** 用的轻量 Context 圆环。

安装后正常打开 Antigravity，输入框麦克风左侧会出现一个细圆环。鼠标悬停显示当前会话的 Context 占用，例如「14% 已用（剩余 86%）」。

不需要选端口、选 Session，也不用每次手动开监控。计算在独立的本地 Node 进程里，Antigravity 里只放很小一块 HUD。

---

## 需要什么

- Windows
- 已安装 [Node.js](https://nodejs.org/)（LTS）
- 已安装 Antigravity Desktop（默认在 `%LOCALAPPDATA%\Programs\antigravity`）
- 能访问 npm（第一次注入会用 `npx @electron/asar`）

## 30 秒安装

1. **完全退出** Antigravity（托盘里也退出）。
2. 克隆本仓库，并**一直保留这个文件夹**（不要装完就删）：

```bat
git clone https://github.com/xiaoliulian99/agy-context-monitor.git
cd agy-context-monitor
```

3. 注入：

```bat
node injector/install.js
```

4. 再打开 Antigravity。看输入框右侧：`[细圆环] [麦克风] [发送]`。

悬停圆环应看到类似：

```
背景信息窗口：
45% 已用（剩余 55%）
已用 115.9k 标记，共 256.0k
```

如果显示「离线，未读取到状态」，等几秒让 Language Server 起来；仍不行就再运行一次 `node injector/install.js`。

## 卸载

```bat
cd agy-context-monitor
node injector/install.js --uninstall
```

然后重启 Antigravity。圆环消失，汉化包（如果有）不会被清掉。

## 请注意

- **不要移动或删除克隆目录。** 启动器会按安装时的绝对路径调用 `src/main.js --watch`。搬家后重新执行 `node injector/install.js`。
- 安装脚本会自动结束 `Antigravity.exe`，以便改 `app.asar`。
- 自有备份是 `resources\app.asar.agy-context.bak`，**不会**覆盖汉化用的 `app.asar.bak`。
- Antigravity **官方更新**会换掉 `app.asar`，圆环会消失。再运行一次 `node injector/install.js` 即可。
- 可用 `node injector/install.js --check` 查看 HUD / 启动器是否还在。

## 命令一览

| 命令 | 作用 |
|---|---|
| `node injector/install.js` | 注入圆环 + 开机自动监控 |
| `node injector/install.js --uninstall` | 只移除本工具的注入 |
| `node injector/install.js --check` | 检查是否已注入 |
| `node src/main.js` | 只打印一次当前 Context（不注入） |
| `node src/main.js --watch` | 前台持续监控 |
| `node tests/context.test.js` | 跑本地单测 |

## 常见问题

**找不到 Antigravity**  
确认本机路径是 `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe`。若装在别处，把安装目录放到环境变量 `ANTIGRAVITY_INSTALL_DIR` 后再注入。

**圆环在，但一直离线**  
先确认仓库还在原路径、Node 还在。任务管理器里应有 `node.exe` 带着 `src\main.js --watch`。没有的话重新注入。

**和中文汉化一起用**  
可以。注入是增量写入 `preload.js` / `main.js`，不会用官方英文包覆盖汉化。

**只想看数字、不想改 Antigravity**  
不运行 `install.js`，直接 `node src/main.js`。
