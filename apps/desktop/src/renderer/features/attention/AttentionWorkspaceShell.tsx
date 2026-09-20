import type { ComponentProps, HTMLAttributes } from 'react';
import { AttentionWorkspaceContext } from './attentionContext.js';

/** 只提供全局侧栏上下文，保持主工作区原有 DOM 层级。 */
export function AttentionWorkspaceShell({ value, ...props }: HTMLAttributes<HTMLElement> & { value: ComponentProps<typeof AttentionWorkspaceContext.Provider>['value'] }) {
  return (
    <AttentionWorkspaceContext.Provider value={value}>
      <main {...props} />
    </AttentionWorkspaceContext.Provider>
  );
}
