# Antigravity Context Monitor

给 **Antigravity Desktop 2.15.0（Windows）** 用的轻量 Context 圆环。

装好后，正常打开 Antigravity，输入框麦克风**左边**会出现一个很细的圆环。鼠标悬停就能看到当前会话的 Context 占用，例如「45% 已用（剩余 55%）」。

你**不用**选端口、选 Session，也**不用**每次手动开监控。计算跑在本机一个独立的 Node 进程里，Antigravity 里只多一小块 HUD。

> 目前只支持 Windows。macOS / Linux 请先不要试。

仓库地址：https://github.com/xiaoliulian99/agy-context-monitor

---

## 1. 装完长什么样

聊天输入框最右侧大致是：

```
[细圆环]  [麦克风]  [发送]
```

把鼠标放到圆环上（或用键盘 focus 到它），会弹出「背景信息窗口」：

```
背景信息窗口：
45% 已用（剩余 55%）
已用 115.9k 标记，共 256.0k
```

如果还没连上监控进程，会显示：

```
背景信息窗口：
离线，未读取到状态
```

圆环颜色含义：

| 颜色 | 含义 |
|---|---|
| 青绿 | 占用不到 50% |
| 琥珀 | 占用 ≥ 50%，或检测到上下文压缩 |
| 红色 | 占用 ≥ 80% |
| 灰色 | 离线（大约 20 秒没读到新鲜状态） |

压缩 / 回绕时，提示里还会多一行黄色警告：

- `注意：检测到上下文压缩`
- `注意：检测到上下文回绕`

（有压缩时只显示压缩，不会两条一起出。）

---

## 2. 开始前准备什么

请逐项确认：

1. **Windows 电脑**（Win10 / Win11 都可以）
2. **已经安装** Antigravity Desktop 2.15.0
3. **已经安装** Node.js LTS，并且能在终端里用
4. **能上网访问 npm**（第一次注入会执行 `npx @electron/asar`，用来解包 / 打包 `app.asar`）
5. 建议安装 **Git**（没有 Git 也可以下载 ZIP，见第 4 节）

Antigravity 默认装在下面两个位置之一，并且该目录里**同时**有 `Antigravity.exe` 和 `resources\app.asar`：

- `%LOCALAPPDATA%\Programs\antigravity`（官方默认，大多数人是这个）
- `C:\Program Files\Antigravity`

把上面第一条复制到资源管理器地址栏回车，就能打开默认安装目录。完整 exe 路径一般是：

```
C:\Users\<你的用户名>\AppData\Local\Programs\antigravity\Antigravity.exe
```

如果装在别的盘子 / 自定义目录，先设置环境变量 `ANTIGRAVITY_INSTALL_DIR` 指向安装目录，或注入时加 `--install-dir`。

---

## 3. 安装并检查 Node.js

还没装 Node 时：

1. 打开 https://nodejs.org/
2. 下载 **LTS**（长期支持版），不要选 Current。
3. 安装时勾上 **Add to PATH**（加到环境变量）。
4. 一路 Next 装完。

**关掉所有已经打开的命令行窗口**，再新开一个，检查：

```bat
node -v
npm -v
```

两边都应该打出版本号，例如：

```
v22.14.0
10.9.2
```

如果提示「不是内部或外部命令」：

1. 确认 Node 真的装好了。默认一般在 `C:\Program Files\nodejs\node.exe`
2. 关掉终端，重新打开再试（PATH 只对新建窗口生效）
3. 还不行就重装 Node.js，务必勾选 Add to PATH

注入脚本会先用 `where.exe node` 找 Node；找不到再试 `C:\Program Files\nodejs\node.exe`。两个都没有就会报 `node.exe not found`。

---

## 4. 下载本仓库（这个文件夹要一直留着）

**非常重要：克隆 / 解压后的文件夹不要删、不要随便搬家。**

启动器会记住安装当时的**绝对路径**，去调用这个文件夹里的 `src\main.js --watch`。装完把文件夹删了，圆环还在，但会一直离线。

路径里尽量不要用网盘同步目录、OneDrive「仅联机」文件。普通桌面、文档、D 盘都可以。

### 方法 A：用 Git（推荐）

新开「命令提示符」或 PowerShell：

```bat
git clone https://github.com/xiaoliulian99/agy-context-monitor.git
cd agy-context-monitor
```

以后所有命令都在这个 `agy-context-monitor` 目录里执行。

### 方法 B：没有 Git，下 ZIP

1. 打开 https://github.com/xiaoliulian99/agy-context-monitor
2. 绿色 **Code** → **Download ZIP**
3. 解压到你打算长期放的位置，例如 `D:\tools\agy-context-monitor`
4. 进去后应能看到 `injector`、`src`、`README.md`、`双击注入圆环.bat`

PowerShell 进入该目录示例：

```powershell
cd D:\tools\agy-context-monitor
```

命令提示符示例：

```bat
cd /d D:\tools\agy-context-monitor
```

---

## 5. 安装前：彻底退出 Antigravity

改 `app.asar` 时文件必须没被占用。请先：

1. 关掉所有 Antigravity 窗口。
2. 看任务栏右下角**托盘**（可能要点 `^` 才展开）。如果还有 Antigravity 图标，右键选退出。
3. 不放心就打开任务管理器，结束所有 `Antigravity.exe`。

注入脚本自己也会执行：

```bat
taskkill /f /im Antigravity.exe /t
```

所以即使你忘了关，脚本一般也会先强行关掉再改文件。未保存的对话请先自己存好。

---

## 6. 执行注入（真正安装圆环）

确认当前目录已经是仓库根目录（能看到 `injector` 文件夹），然后**双击 `双击注入圆环.bat`**（和汉化包一样，官方更新后再双击一次即可）。窗口会停住直到你按键；失败时看同目录的 `inject.log`。

也可以在命令行运行：

```bat
node injector/install.js
```

第一次会做这些事：

1. 找到 Antigravity 安装目录
2. 强制结束 `Antigravity.exe`
3. 把 `resources\app.asar` 复制一份备份：`resources\app.asar.agy-context.bak`（**不会**动汉化用的 `app.asar.bak`）
4. 用 `npx -y @electron/asar` 解包、写入 HUD / 启动器、再打包回去
5. 注入完成后会自动再打开 Antigravity，并拉起监控进程

官方更新后 `app.asar` 会被换掉。脚本发现当前包里没有圆环时，会**刷新** `app.asar.agy-context.bak`，再注入。

成功时终端大致会看到：

```
[探测] Antigravity C:\Users\<你>\AppData\Local\Programs\antigravity (2.15.0)
[1] 正在关闭 Antigravity 以解锁 app.asar...
[备份] 已创建 app.asar.agy-context.bak
[√] 已注入 HUD 到 dist/preload.js
[√] 已注入 bootstrap 到 dist/main.js
[监控] C:\Program Files\nodejs\node.exe C:\...\agy-context-monitor\src\main.js --watch
```

最后一行的两个路径请扫一眼：必须是你这台电脑上的 `node.exe`，以及**这个仓库**里的 `src\main.js`。

想确认注入还在，可以再跑：

```bat
node injector/install.js --check
```

成功应类似：

```
installDir C:\Users\<你>\AppData\Local\Programs\antigravity
version 2.15.0
hud present
bootstrap present
```

`hud` 或 `bootstrap` 显示 `missing` 就再双击一次 `双击注入圆环.bat`。

---

## 7. 打开 Antigravity，确认圆环

1. 重新打开 Antigravity（和平时一样从开始菜单 / 桌面图标进）。
2. 打开任意对话，看输入框右侧：麦克风左边是否有细圆环。
3. 鼠标悬停圆环。

**正常：** 几秒内从「离线」变成百分比和标记数。Language Server 刚启动时，离线一两秒是常见的。

**圆环都没有：** 先看第 11 节 FAQ。

**圆环在，但一直「离线，未读取到状态」：**

1. 等 5～10 秒，让 Language Server 起来。
2. 打开任务管理器 → 详细信息，找是否有 `node.exe`，命令行里应带 `src\main.js --watch`。
3. 没有这个进程：回到仓库目录再双击一次 `双击注入圆环.bat`，然后重启 Antigravity。
4. 确认第 4 节的仓库文件夹还在原位置，没有改名、没有丢进回收站。

监控状态文件在：

```
%LOCALAPPDATA%\agy-context-monitor\status.json
```

资源管理器地址栏粘贴上面这行回车。如果这个文件在更新（改时间一直在变），说明监控进程是活的，问题多半在 HUD 读文件；如果文件不存在或很久不更新，问题在监控进程没起来。

---

## 8. 日常怎么用

装好之后，**平时不用再开这个仓库、不用再敲命令**。只要正常开 Antigravity，启动器会自己拉起监控。

看圆环即可：

- 青绿：还很空
- 琥珀：已经过半，或刚刚发生过压缩
- 红色：接近上限，该考虑新开对话 / 压缩了
- 灰色：监控暂时没连上，先等几秒

不需要在 Antigravity 里选端口，也不用选 Session。它会自己跟当前会话走；切换会话后圆环会马上跟上。

---

## 9. 请务必记住的几件事

1. **不要移动或删除克隆 / 解压目录。** 搬家、改名后，必须在新位置重新双击 `双击注入圆环.bat`。
2. 安装脚本会自动结束 `Antigravity.exe`，以便改 `app.asar`。完成后会自动再打开。
3. 本工具自己的备份是 `resources\app.asar.agy-context.bak`，**不会**覆盖汉化用的 `app.asar.bak`。官方更新后脚本会自动刷新这份备份。
4. Antigravity **官方更新**会换掉 `app.asar`，圆环会消失。更新后再双击一次 `双击注入圆环.bat` 即可。
5. 可以和中文汉化一起用。注入是往 `preload.js` / `main.js` 里增量写入，不会用官方英文包覆盖汉化。建议先汉化，再注入圆环。
6. 只想在终端看数字、不想改 Antigravity：不要跑注入脚本，直接 `node src/main.js`。

---

## 10. 卸载

双击 **`双击卸载圆环.bat`**，或回到仓库目录：

```bat
node injector/install.js --uninstall
```

会先关掉 Antigravity，再从 `app.asar` 里去掉本工具的 HUD 和启动器。成功时看到：

```
[1] 正在关闭 Antigravity 以解锁 app.asar...
[√] 已移除圆环与启动器；汉化包未改动
```

然后重新打开 Antigravity：圆环应消失，汉化包（如果有）还在。

卸载**不会**自动删掉：

- 仓库文件夹（你自己决定留不留）
- `%LOCALAPPDATA%\agy-context-monitor\` 下的 `status.json` / `monitor.pid`
- `resources\app.asar.agy-context.bak` 备份

这些都不影响 Antigravity 使用，想干净可以手动删。

---

## 11. 命令一览

请先 `cd` 到仓库根目录。

| 命令 | 作用 |
|---|---|
| `双击注入圆环.bat` | 注入圆环 + 随 Antigravity 自动监控 |
| `双击卸载圆环.bat` | 只移除本工具的注入 |
| `node injector/install.js` | 同上（命令行） |
| `node injector/install.js --uninstall` | 同上（命令行卸载） |
| `node injector/install.js --check` | 检查 HUD / 启动器是否还在 |
| `node src/main.js` | 只打印一次当前 Context（不改 Antigravity） |
| `node src/main.js --watch` | 前台持续监控（终端要一直开着） |
| `npm test` | 跑本地单测 |

下面这组和上面等价，看你习惯：

```bat
npm run inject
npm run uninject
npm run inject-check
npm start
npm run watch
npm test
```

---

## 12. 常见问题

### 找不到 Antigravity / `Antigravity install dir not found`

脚本默认认：

- `%LOCALAPPDATA%\Programs\antigravity`
- `C:\Program Files\Antigravity`

并且目录里要有 `Antigravity.exe` **和** `resources\app.asar`。

自己打开资源管理器核对。如果在 D 盘便携目录、自定义路径，设置环境变量 `ANTIGRAVITY_INSTALL_DIR`，或：

```bat
node injector/install.js --install-dir "D:\Apps\antigravity"
```

### 双击 bat 窗口一闪而过 / 看起来没注入

窗口应停住等你按键。若一闪而过或失败，打开仓库里的 `inject.log` 看最后几行。常见原因：没装 Node.js、`app.asar` 被占用、第一次 `npx @electron/asar` 没网。

### 提示 `node.exe not found`

Node 没装，或没进 PATH。按第 3 节重装 LTS，并确认：

```bat
where.exe node
```

能打出 `node.exe` 的完整路径。

### 提示 `asar extract failed` / `asar pack failed`

常见原因：

1. 没关干净 Antigravity，`app.asar` 被锁。托盘退出后再注入。
2. 第一次跑 `npx @electron/asar` 需要联网。检查代理 / 防火墙 / npm 镜像。
3. 公司网拦了 npm。换能访问 npm 的网络再试。

可先单独试：

```bat
npx -y @electron/asar --version
```

这条都失败，注入也必然失败。

### 提示 `missing hud.js` 或 `missing src/main.js`

你不在仓库根目录，或 ZIP 没解压完整。确认当前目录下有：

```
injector\install.js
injector\bootstrap\hud.js
src\main.js
```

### 注入成功，但界面上没有圆环

1. 确认已经**重新打开** Antigravity（注入时进程会被杀掉）。
2. 跑 `node injector/install.js --check`，`hud` 和 `bootstrap` 都必须是 `present`。
3. 官方刚更新过会换掉 `app.asar`，再双击一次 `双击注入圆环.bat`。
4. 看的是聊天输入框，不是别的窗口。圆环贴在麦克风按钮左侧。

### 圆环在，但一直离线

按这个顺序查：

1. 等几秒。Language Server 冷启动需要时间。
2. 仓库文件夹还在安装时的绝对路径吗？改名 / 移动 / 删除都会导致启动器找不到 `src\main.js`。
3. 任务管理器里有没有 `node.exe`，命令行是否包含 `src\main.js --watch`。
4. `%LOCALAPPDATA%\agy-context-monitor\status.json` 是否存在、修改时间是否在变。
5. 以上都不对：再双击一次 `双击注入圆环.bat`，然后重启 Antigravity。

### 搬家 / 改文件夹名之后圆环失效

必须在**新路径**下重新注入一次：

```bat
cd /d <新的仓库路径>
双击注入圆环.bat
```

或 `node injector/install.js`。

脚本会把新的绝对路径写进 Antigravity 启动器。

### Antigravity 官方更新后圆环没了

正常。更新会替换 `app.asar`。回到仓库目录再双击 `双击注入圆环.bat`（或 `node injector/install.js`）。

### 和中文汉化一起用会不会把汉化冲掉？

不会。本工具只在 `dist/preload.js` 和 `dist/main.js` 末尾增量写入自己的代码块，卸载时也只删这两段。汉化用的 `app.asar.bak` 不会被覆盖。

建议顺序：先汉化，再注入本工具。如果先注入再汉化，汉化包若整体替换了 `app.asar`，需要再注入一次。

### 只想看数字，不想改 Antigravity

不要运行 `install.js`。先打开 Antigravity，再在仓库目录执行：

```bat
node src/main.js
```

会打印一次当前状态后退出。持续刷新用：

```bat
node src/main.js --watch
```

（这种方式要自己开着终端，不会在输入框里出现圆环。）

### `node src/main.js` 里常见状态

| 输出 | 含义 |
|---|---|
| `Antigravity: not detected` | 两个默认路径里都没找到安装目录 |
| `Antigravity installed but not running` | 装了，但进程没起来 |
| `Language Server: waiting for Antigravity` / `not detected` | 主程序在，语言服务还没起来 |
| `Session: (none)` | 还没有可统计的会话 |
| `Context: 115.9k / 256.0k` 且 `Usage: xx.x%` | 已经在读当前会话 |

---

## 13. 它大概怎么工作（排错用）

可以不看，出问题时对照这个最快。

```
打开 Antigravity
    → 启动器（写在 app.asar 的 dist/main.js 里）
    → 用安装时记下的 node.exe 启动 本仓库\src\main.js --watch
    → 监控进程询问本机 Language Server，算出 Context
    → 写入 %LOCALAPPDATA%\agy-context-monitor\status.json
    → 输入框左侧 HUD（写在 dist/preload.js 里）读这个文件；切会话时会立刻重算
```

所以：

- **没圆环** → 多半是 `app.asar` 里 HUD 没注入，或被官方更新冲掉了
- **有圆环但离线** → 多半是监控进程没起来，或仓库路径变了，或 Language Server 还没好
- **终端 CLI 有数、圆环离线** → 监控在写 `status.json`，但 HUD 读不到（少见；再注入一次）

---

## 14. 安全与备份

- 注入会修改 Antigravity 的 `resources\app.asar`。这是本工具能在输入框里画圆环的原因。
- 第一次注入会留下独立备份：`resources\app.asar.agy-context.bak`。
- 监控只连接本机 Language Server（`127.0.0.1`），不往外发你的对话内容。
- 卸载命令只移除本工具写入的两段代码，不恢复整个 asar，因此汉化会保留。
- 这是非官方配套小工具，Antigravity 大版本更新后可能要重新注入；当前针对 **Desktop 2.15.0**。
