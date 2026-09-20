const projectWorkspaceTabsStorageKey = 'zeus.workspace.project-tabs.v1';

export interface ProjectWorkspaceTabsState {
  projectIds: string[];
  activeProjectId: string | null;
}

function browserProjectWorkspaceStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** 只恢复可验证的项目 ID；本地缓存损坏时退回空状态。 */
export function readProjectWorkspaceTabs(storage = browserProjectWorkspaceStorage()): ProjectWorkspaceTabsState | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(projectWorkspaceTabsStorageKey) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.projectIds)) return null;
    const projectIds = Array.from(new Set(record.projectIds.filter((projectId): projectId is string => typeof projectId === 'string' && projectId.length > 0)));
    const activeProjectId = typeof record.activeProjectId === 'string' && record.activeProjectId.length > 0 ? record.activeProjectId : null;
    return { projectIds, activeProjectId };
  } catch {
    return null;
  }
}

/** 同步写入顺序与当前项目，确保激活项目始终属于已打开列表。 */
export function writeProjectWorkspaceTabs(state: ProjectWorkspaceTabsState, storage = browserProjectWorkspaceStorage()): void {
  if (!storage) return;
  const projectIds = Array.from(new Set(state.projectIds.filter(Boolean)));
  if (state.activeProjectId && !projectIds.includes(state.activeProjectId)) projectIds.push(state.activeProjectId);
  try {
    storage.setItem(projectWorkspaceTabsStorageKey, JSON.stringify({ projectIds, activeProjectId: state.activeProjectId } satisfies ProjectWorkspaceTabsState));
  } catch {
    // 存储不可用时保留当前窗口状态，不阻断项目切换。
  }
}

/** 按当前项目快照过滤已删除项目，并为首次启动补入当前项目。 */
export function resolveProjectWorkspaceTabs(projects: ReadonlyArray<{ id: string }>, fallbackActiveProjectId?: string, persisted: ProjectWorkspaceTabsState | null = readProjectWorkspaceTabs()): ProjectWorkspaceTabsState {
  const knownProjectIds = new Set(projects.map((project) => project.id));
  const projectIds = (persisted?.projectIds ?? []).filter((projectId) => knownProjectIds.has(projectId));
  const activeProjectId =
    (persisted?.activeProjectId && knownProjectIds.has(persisted.activeProjectId) ? persisted.activeProjectId : null) ??
    (fallbackActiveProjectId && knownProjectIds.has(fallbackActiveProjectId) ? fallbackActiveProjectId : null) ??
    projects[0]?.id ??
    null;
  if (activeProjectId && !projectIds.includes(activeProjectId)) projectIds.push(activeProjectId);
  return { projectIds, activeProjectId };
}
