# 课程助手 · Course Assistant

一个在 Windows 本机运行的智慧树随堂练习助手。它通过 Microsoft Edge 和 Playwright 扩展连接你选定的课程视频标签页，用 Codex 或 DeepSeek Harness 判断文字题，并在控制面板显示播放状态与处理记录。

## 功能

- **处理随堂练习**。识别文字单选、判断和多选，等待判题反馈后关闭弹窗并恢复播放。
- **切换判断 Agent**。支持 Codex CLI 和 DeepSeek Harness。可选开启「模型无法确定时随机选择」，默认关闭。
- **提醒和续播**。课程页在后台时提醒切回。确认当前视频结束后，在能识别并操作「下一节」按钮的页面尝试续播。
- **Windows 快捷启动**。双击脚本打开本机控制面板，也可把启动脚本创建为桌面快捷方式。

仅在平台及课程允许自动化的情况下使用。遇到安全验证、异常脚本提示或无法确认的点击结果时，助手会暂停，等待手动检查。

## 快速开始

1. 安装 **Node.js 22 或更高版本** 和 **Microsoft Edge**，再按下文安装 Playwright 扩展。用 GitHub Desktop 克隆仓库，或下载 Releases 中单独提供的 Windows 源码包并解压。 [Node.js 下载](https://nodejs.org/en/download) · [在 Edge 安装 Playwright 扩展](#在-edge-安装-playwright-扩展)
2. 双击 **启动课程助手.cmd**。首次启动会安装依赖，随后在默认浏览器打开控制面板。默认地址为 `http://127.0.0.1:18767`。
3. 配置一个 Agent，在控制面板选择它，再点 **检查 Agent 连接**。检查会发出一次实际的模型请求。
4. 在 Edge 登录并打开课程视频页。点 **连接 Edge**，在 Playwright 扩展提示中选择该标签页并允许连接。
5. 点 **开始处理**，切回课程页并保持在前台。控制面板可留在后台接收提醒。
6. 双击 **停止课程助手.cmd** 可退出助手后台。关闭控制面板标签页时，后台服务会继续运行。

| 判断 Agent | 配置 |
| --- | --- |
| Codex | 安装 Codex CLI，运行 `codex login` 登录。 [Codex CLI 文档](https://developers.openai.com/codex/cli/) |
| DeepSeek Harness | 登录 Harness 并配置默认模型，再安装课程助手连接插件。 [Harness 安装与配对](docs/harness-agent.md) |

## 在 Edge 安装 Playwright 扩展

1. **打开官方扩展页面**。用 Microsoft Edge 打开 Chrome 应用商店中的 Playwright Extension，核对发布者为 **Playwright Team**。 [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
2. **添加到 Edge**。点击商店页上的「获取扩展」或「添加至 Chrome」。如果 Edge 提示「允许来自其他商店的扩展」，选择「允许」，然后继续安装。 [Microsoft Edge 安装扩展说明](https://support.microsoft.com/en-us/edge/add-turn-off-or-remove-extensions-in-microsoft-edge)
3. **确认扩展已启用**。检查安装弹窗中的权限后，点「添加扩展」。在 Edge 地址栏输入 `edge://extensions/`，确认列表里有 **Playwright Extension**，且右侧开关已打开。
4. **授权课程标签页**。在同一个 Edge 用户配置中登录智慧树并打开课程视频页。启动课程助手，在控制面板点「连接 Edge」。在 Playwright 打开的连接提示页中，选中实际播放课程的标签页并允许连接。 [Playwright 标签页授权说明](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md#browser-tab-selection)
5. **确认连接成功**。回到控制面板，看到「已连接，准备就绪」和当前页面标题后，点击「开始处理」，再切回课程标签页。

如果面板停在「等待 Edge 连接确认」，检查 Edge 是否打开了 Playwright 的授权标签页。如果没有看到提示，到 `edge://extensions/` 核对扩展已启用，并确认课程页和扩展在同一个 Edge 用户配置中。

## 兼容性与常见问题

- **视频播完却没切换**。助手会悬停唤出控制栏，识别到唯一可用的「下一节」按钮后才切换。若面板提示找不到按钮，请在课程页手动切换，再确认记录。暂停、缓冲和播放异常只会触发提醒。
- **有未完成记录**。模型阶段中断时，连接原课程页后可点「重试本题」。如果已经进入浏览器操作阶段，先检查课程页，再点「我已手动处理，确认记录」。
- **遇到图片题或开放题**。请手动处理。此项目针对可识别的随堂文字练习，考试、作业和安全验证需要用户操作。
- **默认端口被占用**。停止助手，在 `data/settings.json` 中添加 `"panelPort": 18770`，或填入另一个空闲端口，再重新启动。已有配置时保留其他字段。

## 数据与隐私

控制面板仅监听本机。设置、最近 200 条处理记录和未完成步骤保存在本机 `data/`。题干和选项会发送给所选模型服务。Codex 与 Harness 使用各自的登录与模型设置。

公开源码只包含程序、文档和模拟测试数据。分享日志或反馈问题前，请移除课程链接中的标识、账号信息、配对文件、令牌和真实课程内容。

## 开发与测试

```powershell
npm ci
npm test
```

测试需要已安装 Edge，使用独立浏览器和本机模拟页。运行 `npm run check:agent` 会发出一次真实模型请求。需要构建发布附件时，可在 PowerShell 7 中运行 `pwsh -File scripts/package.ps1`。

[更新记录](CHANGELOG.md) · [MIT 许可证](LICENSE)
