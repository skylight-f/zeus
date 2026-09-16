# Astra 0.1.7 更新内容

## 本次更新

- 恢复会话模块原有的卡片布局、圆角边框及页面底色层次。
- 恢复状态栏用量窗口原有的卡片与背景层次，覆盖浅色、深色和跟随系统主题。
- 保留已合入的功能修复，推送 develop 后默认自动构建 Astra 安装包、校验发行归属并发布到 GitHub Releases。
- 版本号沿用本仓库 skylight-v0.1.6 的发行序列，顺延至 0.1.7。

## 如何升级

从 [Astra 发布页](https://github.com/skylight-f/zeus/releases) 或对应 [GitHub Actions 构建](https://github.com/skylight-f/zeus/actions/workflows/release.yml) 下载 Astra-0.1.7-arm64.dmg，退出应用后安装。

## 系统要求与已知限制

面向 Apple Silicon Mac，要求 macOS 13 或更高版本。签名、公证及自动安装能力以本次更新清单和应用检查结果为准。

## 发布验证

构建执行源码检查、候选检查和安装包校验，具体结果见同一提交对应的 GitHub Actions 记录。卡片样式已完成静态检查和生产构建；本次未完成真实界面的视觉验收。
