# Astra 0.1.10 更新内容

## 本次更新

- 接入 Astra 专用 Homebrew Cask，安装和升级目标统一为 `skylight-f/tap/astra`，避免沿用上游 Zeus 的安装命令。
- 发布流程统一从发行配置读取 Cask 名称，生成 `astra.rb`，同步安装包、SHA-256、更新清单和升级命令；GitHub Release 就绪后同步 Homebrew Tap。
- 修复更新清单解析中写死 `zeus` 的限制，使 Astra 能识别自身 Cask 信息。
- 自动发布优先复用下一版本已编写的发布说明，保留具体更新内容；发布重试继续复用同一候选。

## 如何升级

Homebrew Tap 完成首次公开同步后，新用户可执行：

```bash
brew install --cask skylight-f/tap/astra
```

已通过该 Cask 安装的用户使用：

```bash
brew upgrade --cask skylight-f/tap/astra
```

也可从 [Astra 发布页](https://github.com/skylight-f/zeus/releases/tag/skylight-v0.1.10) 下载 `Astra-0.1.10-arm64.dmg`，退出 Astra 后替换应用。

从 DMG 安装切换到 Homebrew 时，先退出 Astra，备份数据并移走原 `Astra.app`，再执行安装命令；保留数据目录，不要使用清理工具或 `--zap` 卸载旧版。旧版应用若因 Homebrew 发行配置变更无法识别新更新清单，可通过发布页手动升级。

## 数据兼容与卸载

本次改动不更改正式数据根 `~/.zeus`、bundle ID `dev.hypha.zeus` 或历史 `Zeus` 钥匙串服务，不增加清空数据的安装脚本。正常安装和升级继续使用原有数据；应用文件与用户数据分开保存。

需要保留数据时，使用 `brew uninstall --cask skylight-f/tap/astra`。只有明确要清理 Cask 登记的历史配置、缓存和日志时才添加 `--zap`；这些目录可能与 Zeus 共用，清理也会影响仍依赖它们的 Zeus。当前 Cask 的 `--zap` 不包含 `~/.zeus`，不能将其视为完整删除全部用户数据的操作。

## 系统要求与已知限制

- 面向 Apple Silicon Mac，最低要求 macOS 13 Ventura。
- Homebrew 公开安装依赖公开仓库 `skylight-f/homebrew-tap` 中的 `Casks/astra.rb`；维护者需初始化 Tap，并在源码仓库配置具有 Tap Contents 读写权限的 `HOMEBREW_TAP_TOKEN`。Tap 首次同步成功前，请使用 DMG 安装。
- 签名、公证及自动安装能力以本次更新清单和应用检查结果为准，本次接入 Homebrew 不代表新增 Developer ID 签名或 Apple 公证。

## 发布验证

- Homebrew 接入改动已通过 `pnpm verify:publish`，包含格式、静态检查、类型检查和生产构建。
- 已用本机 Homebrew 解析实际发布元数据生成的 Cask，并验证生成的更新清单可由应用解析，安装与升级命令均指向 Astra。
- 上述检查不等同于公开 Tap 安装验收，也未使用真实用户数据执行覆盖安装。正式产物和 Tap 同步结果以本版本对应的 GitHub Actions 记录为准。
