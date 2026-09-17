import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const distributionConfigPath = resolve(import.meta.dirname, '..', 'packages/distribution/src/config.json');

/** 发布前检查运行在干净检出目录，直接读取受版本控制的发行配置，不依赖构建产物 dist。 */
export const zeusDistribution = JSON.parse(readFileSync(distributionConfigPath, 'utf8'));

/** 应用名与安装包前缀统一从发行配置派生，不更改数据根或系统身份。 */
export const distributionAppName = zeusDistribution.appName ?? 'Zeus';
if (!/^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/u.test(distributionAppName)) throw new Error('应用名只接受字母、数字及单个分隔空格。');
export const distributionArtifactPrefix = distributionAppName.replaceAll(' ', '-');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(zeusDistribution.cask)) throw new Error('Homebrew Cask 名称只接受小写字母、数字及单个分隔连字符。');

export function distributionPackageIdentity(variant = 'release') {
  // 测试包保留既有只读验收契约；正式显示名不改变测试宿主身份。
  const name = variant === 'test' ? 'Zeus Test' : distributionAppName;
  return { name, executable: name, bundleId: variant === 'test' ? 'dev.hypha.zeus.test' : 'dev.hypha.zeus' };
}

/** 二开发行号独立维护；两个 package.json 的版本只跟随上游。 */
export const releaseVersionPaths = ['packages/distribution/src/config.json'];

export function readDistributionVersion(root = resolve(import.meta.dirname, '..')) {
  return JSON.parse(readFileSync(resolve(root, releaseVersionPaths[0]), 'utf8')).version;
}

export function assertDistributionVersions(root = resolve(import.meta.dirname, '..')) {
  const version = readDistributionVersion(root);
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('发行包必须使用三段稳定版本号。');
  const rootVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  const desktopVersion = JSON.parse(readFileSync(resolve(root, 'apps/desktop/package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/u.test(rootVersion) || rootVersion !== desktopVersion) throw new Error('根包与桌面包的上游版本必须一致。');
  return version;
}

export function releaseTag(version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`无效发行版本：${version}`);
  return `${zeusDistribution.releaseTagPrefix}${version}`;
}

export function versionFromReleaseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith(zeusDistribution.releaseTagPrefix)) return null;
  const version = tag.slice(zeusDistribution.releaseTagPrefix.length);
  return /^\d+\.\d+\.\d+$/u.test(version) ? version : null;
}
