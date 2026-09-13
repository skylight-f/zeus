import { AutomationsWorkspace } from './tools/AutomationsWorkspace.js';
import { ExtensionsWorkspace } from './tools/ExtensionsWorkspace.js';

/** 桌面渲染端唯一的 SkyLight 组装入口，不向工具页暴露工作台内部状态。 */
export const skylightToolPages = { automations: AutomationsWorkspace, extensions: ExtensionsWorkspace } as const;
export { zeusDistribution, zeusReleaseBaseUrl } from './distribution.js';
