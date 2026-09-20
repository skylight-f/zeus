import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttentionSnapshot } from '@zeus/shared';
import type { DashboardClient } from '../../dashboardClient.js';

/** 状态推送只触发有界刷新；断线保留最近结果，重连重新读取权威集合。 */
export function useAttention(client: DashboardClient | null) {
  const [snapshot, setSnapshot] = useState<AttentionSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async (): Promise<AttentionSnapshot | null> => {
    if (!client) return null;
    const revision = ++generation.current;
    setLoading(true);
    try {
      const next = await client.loadAttention();
      if (revision === generation.current) {
        setSnapshot(next);
        setError(null);
      }
      return next;
    } catch (cause) {
      if (revision === generation.current) setError(cause);
      return null;
    } finally {
      if (revision === generation.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    setConnected(false);
    setLoading(false);
    if (!client) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 500);
    };
    void refresh();
    const unsubscribe = client.subscribeEvents(
      (event) => {
        if (/request|attention|stage|completed|failed|interrupted|automation|task\.work|digital_team|plan_action|answer|resolved/.test(event.type)) schedule();
      },
      (status) => {
        setConnected(status === 'connected');
        if (status === 'connected') schedule();
      },
    );
    const interval = window.setInterval(schedule, 30_000);
    window.addEventListener('focus', schedule);
    return () => {
      generation.current += 1;
      unsubscribe();
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('focus', schedule);
    };
  }, [client, refresh]);

  return { snapshot, error, connected, loading, refresh };
}
