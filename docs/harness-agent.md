# DeepSeek Harness 连接

课程助手的连接插件复用 Harness 已登录账号和当前默认模型。已验证的组合为 **DeepSeek Harness 0.2.1-rc.5** 与 **课程助手连接插件 1.0.1**。其他 Harness 版本的插件兼容性需自行核对。

## 安装与连接

1. 安装 DeepSeek Harness 桌面版，打开一次、登录并选择可用的默认模型。 [Harness 官方发布页](https://github.com/deepseek-ai/deepseek-harness/releases)
2. 下载发布附件 `local-harness-course-agent-1.0.1.tgz`。如果只有源码，可在项目目录运行 `npm pack ./packages/harness-course-agent --ignore-scripts` 生成安装包。
3. 完全退出 Harness，包括托盘进程。若已在 Harness 应用菜单安装桌面版的 `dsh` 命令，在新终端用以下命令安装，将路径换成实际文件位置。 [Harness 桌面插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)

   ```powershell
   dsh plugin --profile desktop add "D:\Downloads\local-harness-course-agent-1.0.1.tgz"
   ```

4. 重新打开 Harness，确认连接插件已启用。保持 Harness 运行，在课程助手面板选择 **DeepSeek Harness**，点击 **检查 Agent 连接**。
5. 检查通过后，连接 Edge 并开始。Harness 更新插件后，完全退出再重新打开可加载新版本。

插件会自动生成 `%USERPROFILE%\.dsh\course-assistant\connection.json`。如果设置了 `DSH_HOME`，则生成在该目录下的 `course-assistant\connection.json`。该文件含本机配对令牌，课程助手会自行读取。安装时请使用 `.tgz` 插件包。

## 连接失败时

- **找不到连接**。确认 Harness 已启动、插件已启用，并使用同一个 Windows 用户运行两个程序。
- **模型调用失败**。在 Harness 内先检查账号登录和默认模型，再回课程助手复查。
- **插件版本不兼容**。核对 Harness 与插件版本，再用上方已验证的组合排查。

插件在本机回环地址监听，使用配对令牌鉴权。它将题干与选项交给 Harness 的文本模型服务，调用时不给模型文件、命令或浏览器工具。扩展其他模型时，可参考 `src/providers.js` 中的 `name`、`solve(question, signal)` 与 `check(signal)` 接口。
