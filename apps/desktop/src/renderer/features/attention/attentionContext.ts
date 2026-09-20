import { createContext, useContext } from 'react';
import type { AttentionTarget } from '@zeus/shared';

export interface AttentionNavigation {
  projectId: string;
  target: AttentionTarget;
  nonce: number;
}
/** 展开状态与一次导航在外壳中保存，切换项目不会关闭侧栏。 */
export const AttentionWorkspaceContext = createContext<{ open: boolean; navigation: AttentionNavigation | null }>({ open: false, navigation: null });
export const useAttentionWorkspace = () => useContext(AttentionWorkspaceContext);
