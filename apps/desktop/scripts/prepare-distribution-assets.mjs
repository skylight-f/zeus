import { assertDistributionVersions } from '../../../scripts/desktop-distribution.mjs';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

assertDistributionVersions();

// 资源由发行包维护；运行时与安装器只读取同一份构建产物。
const source = resolve(import.meta.dirname, '../../../packages/skylight-distribution/assets');
const target = resolve(import.meta.dirname, '../dist/branding');
await mkdir(target, { recursive: true });
for (const name of ['icon.png', 'icon.icns', 'icon-dev.png', 'trayTemplate.png', 'startup-mark.png']) {
  await copyFile(resolve(source, name), resolve(target, name));
}
