# Zeus 二开维护与发布

## 当前渠道

发行仓库为 `skylight-f/zeus`，上游为 `imchenway/zeus`。发行版 ID 为 `skylight-f.zeus`，版本独立递增，目前实现稳定渠道。预览清单会被稳定客户端拒绝；不要把预览版本标记为 latest。首次自有 Release 尚未发布时，更新检查不可用属于真实状态，不回退到上游。

`packages/shared/src/distribution.ts` 是运行时和发布脚本的共同来源，脚本需要 Node 24。Homebrew 默认关闭；创建并验证 `skylight-f/homebrew-tap`、配置 `HOMEBREW_TAP_TOKEN` 后，才将 `homebrewEnabled` 改为 true。

## 一次性仓库设置

1. 确认 origin 是自己的仓库，添加 `upstream` 指向 `https://github.com/imchenway/zeus.git`。main 保持上游镜像；develop 集成二开并承载固定发布候选。Common 基于上游，Custom 在 Common 之上承载完整定制，审阅后才合入 develop。
2. 将工作流合入默认分支后，在 fork 的 Actions 中启用工作流。允许 Actions 创建 PR；同步工作流需要 contents 和 pull-requests 写权限。
3. 为 main 和 develop 配置分支保护；main 只快进同步上游，二开 PR 仅进入 develop。将 GitHub 默认分支设为 develop，让其中的二开 CI 和定时同步工作流生效；不要为启用工作流向 main 写入二开文件。
4. 可配置 `release` Environment，仅允许 develop 发布；审核人和保护规则需要在 GitHub 设置中启用，YAML 引用 Environment 本身不会自动启用审核。
5. 需要应用内自动安装时，配置自己的 Developer ID 和公证凭据：`MACOS_CERTIFICATE`、`MACOS_CERTIFICATE_PASSWORD`，以及 Apple ID 三项或 App Store Connect API Key 三项。它们当前由 preflight/package 作业从仓库 Secrets 读取。没有签名和公证时只允许手动安装，不冒充可自动安装的版本。

## 保持上游同步

`Sync upstream` 每周一检查最新稳定 Release，也可手动执行。它从 develop 创建 `sync/upstream-vX.Y.Z`，以 merge 保留上游历史，记录真实基线提交并创建 PR，不自动合并或发布。

发现冲突时工作流失败并列出冲突文件；到本地从 develop 建立同名同步分支，fetch 指定上游 tag，然后 merge、逐项解决冲突、运行门禁，再推送 PR。禁止整片选择 ours/theirs。上游改动与二开同时修改发行配置时必须保留自己的渠道。

自动创建的 PR 可能需要批准才能启动 CI，不能假设创建 PR 等于检查通过；必要时从 Actions 手动启动 CI 并选择同步分支。同步 PR 只进入 develop，保留 merge commit；main 的上游镜像独立维护。

`releases/upstream-baseline.json` 初始基线为空，表示尚未核实；首次成功同步写入真实 tag/commit。不要手填猜测的上游提交。每份生成清单还记录二开 sourceCommit，便于问题追溯。

二开功能保持模块边界：发行信息集中配置，主题样式单独维护，业务功能通过少量入口接入。每次同步真实验证临时会话、导航、全局搜索、技能分类和滚动、自动化卡片以及更新来源。

## 首次发布及后续候选

先写中文发布说明，标题为 `# Zeus X.Y.Z 更新内容`，包括“如何升级”“系统要求与已知限制”“发布验证”。只填写已经取得的验证事实，提供本仓库 Release 地址和 `Zeus-X.Y.Z-arm64.dmg` 文件名；未启用 Homebrew 时不推荐 Tap 命令。

```bash
RELEASE_VERSION=0.4.0 RELEASE_NOTES_FILE=/absolute/path/notes.md pnpm release:fork:prepare
RELEASE_VERSION=0.4.0 RELEASE_NOTES_FILE=/absolute/path/notes.md APPLY_CHANGES=1 pnpm release:fork:prepare
pnpm verify:publish
pnpm dev
```

版本号只是例子，应高于当前版本和已公开版本。准备命令只修改两个 package.json 和版本发布说明，不提交、不推送、不创建标签。先审阅、提交到自己的仓库，并通过 PR 合入 develop。

在 Actions → Release 中填写 develop 的完整 40 位 commit SHA 和 `vX.Y.Z`，保持 `publish_release=false`，执行候选构建并下载 Actions 产物检查。公开发布时重新选择同一提交并启用 `publish_release`；需要自动安装则同时选择严格 Apple 分发。

公开流程会复核 develop 的固定提交、不可变标签、清单归属、候选 sourceCommit 和版本，门禁及打包通过后才发布。当前产物为 macos-latest 架构构建的 DMG（当前主要验收 arm64），不声称同时支持 Intel。旧的 `pnpm release` 是会提交并推送 develop 的全流程工具，首次发行请使用上述显式流程；只有明确授权公开发布时才运行它。

GitHub Release 和 Homebrew 分步执行。发布后 Tap 同步失败，应基于已公开清单和 DMG 单独恢复 Tap 同步。重新构建的 DMG 摘要若变化，流程会拒绝覆盖既有 Release；内容改变应递增版本。运行时先从自己的发布源检查，再校验摘要、签名与现有安装身份，通过用户确认和宿主关闭流程后安装。

## 现有安装与数据

本次保持 Zeus 名称、Bundle ID、Keychain 和数据目录，避免静默迁移现有数据。发行 ID 负责拒绝原版更新清单；它不等价于 macOS 应用身份隔离。因此不要同时安装原版与当前二开版，也不要用原作者 Homebrew Tap 升级本版。

旧版程序内嵌的上游更新地址不会因仓库配置改变而自动变化。首次切换到二开渠道需要手动安装自己的候选/发行包；不要尝试让原作者的更新服务器分发本版。未来独立身份必须同时调整主程序、辅助进程、浏览器扩展、Keychain 与数据根校验，并提供经过用户确认的数据导入。

升级前备份重要数据；出现需要回退的数据库迁移时，使用匹配备份恢复，不能只降级程序。优先发布递增版本的修复包，避免更改已经公开的标签和资产。

参考：[GitHub 工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Environment 设置](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)。
