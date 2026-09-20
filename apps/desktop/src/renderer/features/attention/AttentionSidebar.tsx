import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { AttentionItem, AttentionKind } from '@zeus/shared';
import { TrayIcon } from '@phosphor-icons/react/dist/csr/Tray';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { ZeusSelect } from '../../ZeusSelect.js';
import { VisibleApplicationError } from '../../ui/ApplicationErrorDialog.js';
import type { useAttention } from './useAttention.js';
import './attention.css';

type AttentionState = ReturnType<typeof useAttention>;
const labels: Record<AttentionKind, [string, string]> = {
  reply: ['需要回复', 'Reply needed'],
  approval: ['需要授权', 'Approval needed'],
  review: ['等待验收', 'Review needed'],
  failure: ['异常待处理', 'Needs attention'],
  unknown: ['结果待核对', 'Check outcome'],
  completed: ['已完成', 'Completed'],
  update: ['新动态', 'New activity'],
};

export function AttentionToggle(props: { open: boolean; state: AttentionState; language: string; onClick(): void; standalone?: boolean }) {
  const count = props.state.snapshot?.items.filter((item) => item.bucket === 'pending').length;
  const zh = props.language === 'zh-CN';
  const unavailable = Boolean(props.state.error) || !props.state.connected;
  const label = `${zh ? '待我处理' : 'Needs my attention'}${count === undefined ? '' : ` · ${count}`}${unavailable ? (zh ? ' · 正在同步' : ' · Sync pending') : ''}`;
  return (
    <button type="button" className={`attention-toggle${props.standalone ? ' is-standalone' : ''}`} aria-label={label} title={label} aria-expanded={props.open} aria-controls="workspace-attention-sidebar" onClick={props.onClick}>
      <TrayIcon size={20} aria-hidden="true" />
      {count ? (
        <span className="attention-badge" data-stale={unavailable || undefined}>
          {count > 99 ? '99+' : count}
        </span>
      ) : unavailable ? (
        <span className="attention-sync-dot" />
      ) : null}
    </button>
  );
}

/** 条目始终定位原业务页面，不在聚合侧栏复制审批逻辑。 */
export function AttentionSidebar(props: { open: boolean; width: number; language: 'zh-CN' | 'en-US'; state: AttentionState; onClose(): void; onWidthChange(width: number): void; onOpen(item: AttentionItem): Promise<void> }) {
  const zh = props.language === 'zh-CN';
  const [project, setProject] = useState('all');
  const [tab, setTab] = useState<'pending' | 'activity'>('pending');
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useEffect(() => {
    if (!props.open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>('header button')?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // 子级选择器和弹窗先处理自己的 Escape。
      if (document.querySelector('[role="dialog"], [role="listbox"]')) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      if (panelRef.current?.contains(document.activeElement)) previous?.focus();
    };
  }, [props.open]);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const actionInFlight = useRef(false);
  const items = props.state.snapshot?.items ?? [];
  const projects = [...new Map(items.map((item) => [item.projectId, item.projectName])).entries()];
  const scoped = project === 'all' ? items : items.filter((item) => item.projectId === project);
  const visible = scoped.filter((item) => item.bucket === tab);
  const resize = (width: number) => props.onWidthChange(Math.max(300, Math.min(520, width)));
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, width: props.width };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    resize(event.key === 'Home' ? 300 : event.key === 'End' ? 520 : props.width + (event.key === 'ArrowLeft' ? 20 : -20));
  };
  async function openItem(item: AttentionItem) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setOpening(item.id);
    setActionError(null);
    setNotice(null);
    try {
      const current = await props.state.refresh();
      if (!current) {
        setNotice(zh ? '暂时无法核对当前状态，请稍后重试。' : 'Cannot verify the current state. Try again.');
        return;
      }
      const fresh = current.items.find((candidate) => candidate.id === item.id);
      if (!fresh) {
        setNotice(zh ? '该事项已处理或状态已变化，列表已更新。' : 'This item has been handled or changed. The list is updated.');
        return;
      }
      await props.onOpen(fresh);
    } catch (cause) {
      setActionError(cause);
    } finally {
      actionInFlight.current = false;
      setOpening(null);
    }
  }
  return (
    <aside ref={panelRef} id="workspace-attention-sidebar" className="attention-sidebar" hidden={!props.open} aria-label={zh ? '跨项目待我处理' : 'Cross-project attention'}>
      <div
        className="attention-resizer"
        role="separator"
        tabIndex={0}
        aria-label={zh ? '调整待办侧栏宽度' : 'Resize attention sidebar'}
        aria-orientation="vertical"
        aria-valuemin={300}
        aria-valuemax={520}
        aria-valuenow={props.width}
        onPointerDown={startResize}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={resizeByKey}
        onDoubleClick={() => resize(360)}
      />
      <header className="attention-header">
        <strong>{zh ? '待我处理' : 'Needs my attention'}</strong>
        <span className="attention-header-actions">
          <button type="button" aria-label={zh ? '刷新待办' : 'Refresh attention'} title={zh ? '刷新' : 'Refresh'} disabled={props.state.loading} onClick={() => void props.state.refresh()}>
            <ArrowClockwiseIcon size={17} />
          </button>
          <button type="button" aria-label={zh ? '关闭待办侧栏' : 'Close attention sidebar'} onClick={props.onClose}>
            <XIcon size={17} />
          </button>
        </span>
      </header>
      <div className="attention-controls">
        <ZeusSelect
          ariaLabel={zh ? '筛选待办项目' : 'Filter attention by project'}
          value={project}
          onChange={setProject}
          size="compact"
          options={[
            { value: 'all', label: zh ? '全部项目' : 'All projects' },
            ...projects.map(([value, label]) => ({ value, label })),
            ...(project !== 'all' && !projects.some(([id]) => id === project) ? [{ value: project, label: zh ? '所选项目（暂无事项）' : 'Selected project (no items)' }] : []),
          ]}
        />
        <div className="attention-tabs" aria-label={zh ? '待办范围' : 'Attention scope'}>
          {(['pending', 'activity'] as const).map((value) => (
            <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
              {value === 'pending' ? (zh ? '待处理' : 'Pending') : zh ? '动态' : 'Activity'} <span>{scoped.filter((item) => item.bucket === value).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="attention-feedback" role="status" aria-live="polite">
        {props.state.error ? (
          <VisibleApplicationError error={props.state.error} language={zh ? 'zh-CN' : 'en'} />
        ) : !props.state.connected ? (
          zh ? (
            '连接恢复后自动同步；保留上次读取结果。'
          ) : (
            'Keeping the last result. Sync resumes after reconnecting.'
          )
        ) : !props.state.snapshot ? (
          zh ? (
            '正在读取全部项目的待办…'
          ) : (
            'Loading attention across projects…'
          )
        ) : null}
        {notice ? <p>{notice}</p> : null}
        {actionError ? <VisibleApplicationError error={actionError} language={zh ? 'zh-CN' : 'en'} /> : null}
      </div>
      <div className="attention-list">
        {visible.map((item) => (
          <article key={item.id} className="attention-item" data-kind={item.kind}>
            <div className="attention-item-meta">
              <span>{labels[item.kind][zh ? 0 : 1]}</span>
              <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString(props.language)}>
                {formatAge(item.createdAt, zh)}
              </time>
            </div>
            <button type="button" className="attention-item-open" disabled={opening !== null} onClick={() => void openItem(item)}>
              <strong>{item.title}</strong>
              <CaretRightIcon size={14} aria-hidden="true" />
            </button>
            <div className="attention-item-source">
              {item.projectName} · {sourceLabel(item.source, zh)}
              {item.sourceTitle !== item.title && item.sourceTitle ? ` · ${item.sourceTitle}` : ''}
            </div>
            {item.summary && item.summary !== item.title ? <p>{item.summary}</p> : null}
            <div className="attention-item-action">
              <span>{item.blocking ? (zh ? '正在等待你继续' : 'Waiting for you') : ''}</span>
              <button type="button" disabled={opening !== null} onClick={() => void openItem(item)}>
                {opening === item.id ? (zh ? '正在定位…' : 'Opening…') : item.kind === 'review' ? (zh ? '去验收' : 'Review') : tab === 'activity' ? (zh ? '查看结果' : 'View result') : zh ? '去处理' : 'Open'}
              </button>
            </div>
          </article>
        ))}
        {!visible.length && props.state.snapshot && !props.state.error && props.state.connected ? (
          <p className="attention-empty">{tab === 'pending' ? (zh ? '当前没有需要你处理的事项' : 'Nothing needs your attention') : zh ? '暂无新的完成动态' : 'No new completion updates'}</p>
        ) : null}
      </div>
      <footer className="attention-footer">{zh ? '查看不会完成待办；处理后自动更新。' : 'Viewing does not resolve requests. Updates sync after handling.'}</footer>
    </aside>
  );
}

function sourceLabel(source: AttentionItem['source'], zh: boolean): string {
  return ({ conversation: ['会话', 'Conversation'], automation: ['自动化', 'Automation'], digital_employee: ['数字员工', 'Employee'], digital_team: ['数字团队', 'Team'] } as const)[source][zh ? 0 : 1];
}
function formatAge(value: string, zh: boolean): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return zh ? '刚刚' : 'Just now';
  const unit = minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day';
  const count = unit === 'minute' ? minutes : unit === 'hour' ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
  return new Intl.RelativeTimeFormat(zh ? 'zh-CN' : 'en', { numeric: 'auto' }).format(-count, unit);
}
