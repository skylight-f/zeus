/** 二开发行配置：上游同步不得覆盖此文件；更新来源和发布脚本共同使用。 */
export const zeusDistribution = {
  id: 'skylight-f.zeus',
  repository: 'skylight-f/zeus',
  upstreamRepository: 'imchenway/zeus',
  releaseBranch: 'develop',
  integrationBranch: 'develop',
  channel: 'stable',
  // 建立并验证自己的 Tap 后再启用，首次发行不依赖第二个仓库。
  homebrewEnabled: false,
  homebrewTap: 'skylight-f/tap',
  homebrewRepository: 'skylight-f/homebrew-tap',
  cask: 'zeus',
} as const;

export const zeusReleaseBaseUrl = `https://github.com/${zeusDistribution.repository}/releases`;
export const zeusReleaseManifestUrl = `${zeusReleaseBaseUrl}/latest/download/zeus-release-manifest.json`;
export const zeusHomebrewCask = `${zeusDistribution.homebrewTap}/${zeusDistribution.cask}`;

/** 仅允许本发行版的 GitHub Release 地址，不接受名称相似的仓库或 URL 凭据。 */
export function isZeusReleaseUrl(value: string, downloadOnly = false): boolean {
  try {
    const url = new URL(value);
    const prefix = `/${zeusDistribution.repository}/releases/`;
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && url.pathname.startsWith(downloadOnly ? `${prefix}download/` : prefix);
  } catch {
    return false;
  }
}
