import { isInteractiveShellSession } from '@zeus/shared';
import type { RuntimeApiClient } from './runtimeApiClient.js';

const projectTerminalCleanupTimeoutMs = 12_000;
const projectTerminalCleanupPollMs = 100;

type ProjectTerminalClient = Pick<RuntimeApiClient, 'loadRuntimeSessions' | 'stopRuntimeSession'>;

/** 项目标签只有在全部交互终端进程树确认退出后才允许关闭。 */
export async function terminateProjectTerminalSessions(client: ProjectTerminalClient | null, projectId: string): Promise<number> {
  if (!client) throw projectTerminalCleanupError('项目终端服务尚未连接，无法确认后台进程已经退出。');

  const deadline = Date.now() + projectTerminalCleanupTimeoutMs;
  const requestedSessionIds = new Set<string>();
  const stopFailures: unknown[] = [];

  while (true) {
    let sessions: Awaited<ReturnType<ProjectTerminalClient['loadRuntimeSessions']>>;
    try {
      sessions = await client.loadRuntimeSessions({ projectId });
    } catch (error) {
      throw projectTerminalCleanupError('无法读取项目终端状态，项目标签已保留。', error);
    }

    /** 只清理项目终端，不中断任务 Runtime 或对话工具进程。 */
    const activeTerminals = sessions.filter(
      (session) => session.projectId === projectId && isInteractiveShellSession(session) && (session.status === 'running' || session.status === 'orphan_detected'),
    );
    if (activeTerminals.length === 0) return requestedSessionIds.size;

    const unrequested = activeTerminals.filter((session) => !requestedSessionIds.has(session.id));
    if (unrequested.length > 0) {
      for (const session of unrequested) requestedSessionIds.add(session.id);
      const results = await Promise.allSettled(unrequested.map((session) => client.stopRuntimeSession(session.id)));
      for (const result of results) if (result.status === 'rejected') stopFailures.push(result.reason);
    }

    if (Date.now() >= deadline) {
      const sessionIds = activeTerminals.map((session) => session.id).join(', ');
      const timeout = new Error(`以下项目终端未能在关闭前确认退出：${sessionIds}`);
      throw projectTerminalCleanupError('项目终端未能完整退出，项目标签已保留。', stopFailures.length > 0 ? new AggregateError([...stopFailures, timeout]) : timeout);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(projectTerminalCleanupPollMs, Math.max(0, deadline - Date.now()))));
  }
}

function projectTerminalCleanupError(message: string, cause?: unknown): Error & { code: 'ZEUS_PROJECT_TERMINAL_CLEANUP_FAILED' } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code: 'ZEUS_PROJECT_TERMINAL_CLEANUP_FAILED' as const });
}
