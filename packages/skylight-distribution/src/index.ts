import type { DistributionConfig } from '@zeus/shared';

/** SkyLight 发行信息只在此包维护，应用入口负责注入。 */
export const skylightDistribution = {
  id: 'skylight-f.zeus',
  repository: 'skylight-f/zeus',
  upstreamRepository: 'imchenway/zeus',
  releaseBranch: 'develop',
  releaseTagPrefix: 'skylight-v',
  integrationBranch: 'develop',
  channel: 'stable',
  // 建立并验证自己的 Tap 后再启用，首次发行不依赖第二个仓库。
  homebrewEnabled: false,
  homebrewTap: 'skylight-f/tap',
  homebrewRepository: 'skylight-f/homebrew-tap',
  cask: 'zeus',
  requireManifestIdentity: true,
} as const satisfies DistributionConfig;
