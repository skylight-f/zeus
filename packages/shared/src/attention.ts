/** 待办中心只聚合原业务状态，不拥有审批或任务状态。 */
export type AttentionKind = 'reply' | 'approval' | 'review' | 'failure' | 'unknown' | 'completed' | 'update';

/** 导航保留原请求身份，禁止用会话标题代替定位。 */
export type AttentionTarget =
  | { kind: 'conversation'; conversationId: string; requestId?: string; questionItemId?: string; planId?: string; turnId?: string }
  | { kind: 'task_decision'; taskId: string; decisionId: string }
  | { kind: 'digital_team'; runId: string; nodeId?: string }
  | { kind: 'automation'; runId: string };

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  summary: string;
  kind: AttentionKind;
  source: 'conversation' | 'automation' | 'digital_employee' | 'digital_team';
  sourceTitle: string;
  createdAt: string;
  revision: string;
  blocking: boolean;
  bucket: 'pending' | 'activity';
  /** 用户关闭的是当前版本的提醒，不改变原业务请求；新版本重新进入待处理。 */
  closedAt?: string | null;
  target: AttentionTarget;
}

export interface SetAttentionItemClosedInput {
  id: string;
  revision: string;
  closed: boolean;
}

export interface AttentionItemState {
  id: string;
  revision: string;
  closedAt: string | null;
}

export interface AttentionSnapshot {
  items: AttentionItem[];
  generatedAt: string;
}
