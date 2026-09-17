import { createDistributionContext } from '@zeus/shared';
import { desktopDistribution } from '@zeus/distribution';

/** 开发态使用二开发行号；打包态由 Electron 读取产物中写入的同一版本。 */
export const distributionVersion = desktopDistribution.version;

/** 主进程和执行宿主共用的发行组装入口；服务层只接收此处的配置。 */
export const { appName: distributionAppName, zeusDistribution, zeusReleaseBaseUrl, zeusReleaseManifestUrl, zeusHomebrewCask, isZeusReleaseUrl } = createDistributionContext(desktopDistribution);
