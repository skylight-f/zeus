import type { GitFileStatusSummary } from '../features/git/gitContracts.js';
import './gitFileStatusIcon.css';

const labels = {
  added: ['新增', 'Added'],
  modified: ['修改', 'Modified'],
  deleted: ['删除', 'Deleted'],
  renamed: ['重命名', 'Renamed'],
  untracked: ['未跟踪', 'Untracked'],
  conflict: ['冲突', 'Conflict'],
  copied: ['复制', 'Copied'],
  typechange: ['类型变化', 'Type changed'],
  other: ['变更', 'Changed'],
} as const;
type FileStatusCategory = keyof typeof labels;
const statusCodes: Record<string, FileStatusCategory> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange', U: 'conflict', '?': 'untracked' };

/** 暂存区和工作区各自显示该侧状态，避免 AM 文件两边都显示新增。 */
export function gitFileStatusCategory(file: GitFileStatusSummary | undefined, stage?: 'staged' | 'unstaged'): FileStatusCategory {
  if (!file) return 'other';
  if (file.category === 'conflict' || ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(file.indexStatus + file.workingTreeStatus)) return 'conflict';
  if (stage) return statusCodes[stage === 'staged' ? file.indexStatus : file.workingTreeStatus] ?? 'other';
  if (file.category === 'other') return statusCodes[file.indexStatus.trim() || file.workingTreeStatus.trim()] ?? 'other';
  return Object.hasOwn(labels, file.category) ? (file.category as FileStatusCategory) : 'other';
}

export function gitFileStatusLabel(category: FileStatusCategory, zh: boolean): string {
  return labels[category][zh ? 0 : 1];
}

/** 颜色和符号同时区分状态，行尾无需重复状态文字。 */
export function GitFileStatusIcon(props: { category: FileStatusCategory; zh: boolean }) {
  const label = gitFileStatusLabel(props.category, props.zh);
  return (
    <svg className="git-file-status-icon" data-status={props.category} viewBox="0 0 20 20" role="img" aria-label={label}>
      <title>{label}</title>
      <rect className="git-file-status-background" x="1" y="1" width="18" height="18" rx="4" />
      <g className="git-file-status-symbol" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {props.category === 'added' ? <path d="M10 5.5v9M5.5 10h9" /> : null}
        {props.category === 'deleted' ? <path d="M5.5 10h9" /> : null}
        {props.category === 'modified' ? (
          <g fill="white" stroke="none">
            <circle cx="5.5" cy="10" r="1.3" />
            <circle cx="10" cy="10" r="1.3" />
            <circle cx="14.5" cy="10" r="1.3" />
          </g>
        ) : null}
        {props.category === 'untracked' ? (
          <>
            <path d="M7 7a3 3 0 0 1 6 0c0 2-3 2-3 4" />
            <circle cx="10" cy="14.5" r="1" fill="white" stroke="none" />
          </>
        ) : null}
        {props.category === 'conflict' ? (
          <>
            <path d="M10 5v6" />
            <circle cx="10" cy="14.5" r="1" fill="white" stroke="none" />
          </>
        ) : null}
        {props.category === 'renamed' ? <path d="M5 10h10m-4-4 4 4-4 4" /> : null}
        {props.category === 'copied' ? (
          <>
            <path d="M7 7V4.5h8.5V13H13" />
            <rect x="4.5" y="7" width="8.5" height="8.5" rx="1" />
          </>
        ) : null}
        {props.category === 'typechange' ? <path d="M5 7h10l-3-3M15 13H5l3 3" /> : null}
        {props.category === 'other' ? <path d="m10 5 5 5-5 5-5-5Z" /> : null}
      </g>
    </svg>
  );
}
