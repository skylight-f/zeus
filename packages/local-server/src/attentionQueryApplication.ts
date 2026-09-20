import { asyncMessageQuestions } from '@zeus/shared';
import type { AttentionItem, AttentionKind, AttentionSnapshot } from '@zeus/shared';
import type {
  AutomationRunRepository,
  AutomationTaskRepository,
  ConversationPlanActionRepository,
  ConversationRepository,
  ConversationServerRequestRepository,
  DigitalTeamNodeAttemptRepository,
  DigitalTeamWorkflowRunRepository,
  ProjectRepository,
  TaskRepository,
  TaskWorkDecisionRepository,
  ZeusConversationRecord,
} from '@zeus/storage';

interface AttentionQueryPorts {
  projects: Pick<ProjectRepository, 'list'>;
  tasks: Pick<TaskRepository, 'getById'>;
  conversations: Pick<ConversationRepository, 'listUnarchivedRecords' | 'getRecordById' | 'listUnansweredQuestions'>;
  requests: Pick<ConversationServerRequestRepository, 'listPending'>;
  plans: Pick<ConversationPlanActionRepository, 'listPending'>;
  decisions: Pick<TaskWorkDecisionRepository, 'listPending'>;
  teamRuns: Pick<DigitalTeamWorkflowRunRepository, 'listAttention'>;
  teamAttempts: Pick<DigitalTeamNodeAttemptRepository, 'listByRun'>;
  automationRuns: Pick<AutomationRunRepository, 'listAttention'>;
  automationTasks: Pick<AutomationTaskRepository, 'getById'>;
  redact: (text: string) => string;
}

/** 只读汇总全部项目，原始请求、决定和运行仍是唯一状态来源。 */
export class AttentionQueryApplication {
  constructor(private readonly ports: AttentionQueryPorts) {}

  read(): AttentionSnapshot {
    const generatedAt = new Date().toISOString();
    const projects = new Map(this.ports.projects.list().map((project) => [project.id, project]));
    const conversations = new Map(this.ports.conversations.listUnarchivedRecords().map((conversation) => [conversation.id, conversation]));
    const items: AttentionItem[] = [];
    const pendingConversations = new Set<string>();
    const getConversation = (id: string): ZeusConversationRecord | undefined => {
      const value = conversations.get(id) ?? this.ports.conversations.getRecordById(id);
      if (value) conversations.set(id, value);
      return value && !value.archived && projects.has(value.projectId) ? value : undefined;
    };
    const add = (item: Omit<AttentionItem, 'projectName'>): void => {
      const project = projects.get(item.projectId);
      if (!project) return;
      items.push({ ...item, projectName: project.name, title: this.ports.redact(item.title).slice(0, 240), summary: this.ports.redact(item.summary).slice(0, 1_200), sourceTitle: this.ports.redact(item.sourceTitle).slice(0, 240) });
    };

    for (const request of this.ports.requests.listPending()) {
      const conversation = getConversation(request.conversationId);
      if (!conversation) continue;
      pendingConversations.add(conversation.id);
      if (request.expiresAt && request.expiresAt <= generatedAt) continue;
      const input = request.requestKind === 'request_user_input';
      const payload = request.containsSecret ? {} : parseObject(request.payloadJson);
      const question = Array.isArray(payload.questions) ? payload.questions.find(isRecord) : undefined;
      const description = input ? stringValue(question?.question) : stringValue(payload.reason) || stringValue(payload.command);
      add({
        id: `request:${request.id}`,
        projectId: conversation.projectId,
        title: description || (input ? '会话需要你补充信息' : '会话正在等待授权'),
        summary: request.containsSecret ? '此请求包含敏感信息，请在原会话中查看和处理。' : description,
        kind: input ? 'reply' : 'approval',
        source: conversation.automationRunId ? 'automation' : conversation.taskId ? 'digital_employee' : 'conversation',
        sourceTitle: conversation.title,
        createdAt: request.createdAt,
        revision: request.transportGenerationId,
        blocking: true,
        bucket: 'pending',
        target: { kind: 'conversation', conversationId: conversation.id, requestId: request.id, ...(request.turnId ? { turnId: request.turnId } : {}) },
      });
    }
    for (const question of this.ports.conversations.listUnansweredQuestions()) {
      const conversation = getConversation(question.conversationId);
      const questions = asyncMessageQuestions(parseObject(question.metadataJson));
      if (!conversation || !questions.length) continue;
      pendingConversations.add(conversation.id);
      add({
        id: `question:${conversation.id}:${question.providerTurnId}:${question.providerItemId}`,
        projectId: conversation.projectId,
        title: questions[0]!.question,
        summary: questions
          .slice(1)
          .map((item) => item.question)
          .join('；'),
        kind: 'reply',
        source: 'conversation',
        sourceTitle: conversation.title,
        createdAt: question.createdAt,
        revision: question.createdAt,
        blocking: false,
        bucket: 'pending',
        target: { kind: 'conversation', conversationId: conversation.id, turnId: question.providerTurnId, questionItemId: question.providerItemId },
      });
    }
    for (const plan of this.ports.plans.listPending()) {
      const conversation = getConversation(plan.conversationId);
      if (!conversation) continue;
      pendingConversations.add(conversation.id);
      add({
        id: `plan:${plan.id}`,
        projectId: conversation.projectId,
        title: '确认是否实施当前计划',
        summary: '查看原会话中的完整计划，再选择实施或继续调整。',
        kind: 'approval',
        source: 'conversation',
        sourceTitle: conversation.title,
        createdAt: plan.createdAt,
        revision: plan.updatedAt,
        blocking: true,
        bucket: 'pending',
        target: { kind: 'conversation', conversationId: conversation.id, planId: plan.id, turnId: plan.turnId },
      });
    }
    for (const decision of this.ports.decisions.listPending()) {
      if (decision.expiresAt && decision.expiresAt <= generatedAt) continue;
      const task = this.ports.tasks.getById(decision.taskId);
      if (!task || task.status === 'completed' || task.status === 'cancelled') continue;
      const kinds: Record<typeof decision.kind, AttentionKind> = {
        input_required: 'reply',
        authorization: 'approval',
        command_confirmation: 'approval',
        deliverable_acceptance: 'review',
        command_failure: 'failure',
        outcome_unknown: 'unknown',
      };
      add({
        id: `decision:${decision.id}`,
        projectId: decision.projectId,
        title: decision.title,
        summary: decision.prompt,
        kind: kinds[decision.kind],
        source: 'digital_employee',
        sourceTitle: task.title,
        createdAt: decision.createdAt,
        revision: String(decision.revision),
        blocking: decision.kind !== 'deliverable_acceptance',
        bucket: 'pending',
        target: { kind: 'task_decision', taskId: decision.taskId, decisionId: decision.id },
      });
    }
    for (const run of this.ports.teamRuns.listAttention()) {
      const task = this.ports.tasks.getById(run.taskId);
      if (!task || task.status === 'completed' || task.status === 'cancelled') continue;
      const attempts = this.ports.teamAttempts.listByRun(run.id);
      const latest = new Map<string, (typeof attempts)[number]>();
      for (const attempt of attempts) if (!latest.has(attempt.nodeId) || latest.get(attempt.nodeId)!.attempt < attempt.attempt) latest.set(attempt.nodeId, attempt);
      const awaiting = [...latest.values()].filter((attempt) => attempt.status === 'awaiting_approval');
      for (const attempt of awaiting) {
        const node = run.definitionSnapshot.nodes.find((candidate) => candidate.id === attempt.nodeId);
        const final = node?.type === 'human_confirmation' && node.data.purpose === 'final_acceptance';
        add({
          id: `team:${attempt.id}`,
          projectId: run.projectId,
          title: final ? '数字团队成果等待最终验收' : '数字团队计划等待批准',
          summary: stringValue(node?.data.instructions),
          kind: final ? 'review' : 'approval',
          source: 'digital_team',
          sourceTitle: task.title,
          createdAt: attempt.createdAt,
          revision: `${run.revision}:${attempt.revision}`,
          blocking: true,
          bucket: 'pending',
          target: { kind: 'digital_team', runId: run.id, nodeId: attempt.nodeId },
        });
      }
      if (!awaiting.length && (run.status === 'outcome_unknown' || run.status === 'failed')) {
        add({
          id: `team-run:${run.id}`,
          projectId: run.projectId,
          title: run.status === 'outcome_unknown' ? '数字团队运行结果需要核对' : '数字团队运行失败',
          summary: '打开运行记录，核对当前节点和已有结果后决定下一步。',
          kind: run.status === 'outcome_unknown' ? 'unknown' : 'failure',
          source: 'digital_team',
          sourceTitle: task.title,
          createdAt: run.updatedAt,
          revision: String(run.revision),
          blocking: false,
          bucket: 'pending',
          target: { kind: 'digital_team', runId: run.id },
        });
      }
    }
    const automationConversationIds = new Set<string>();
    for (const run of this.ports.automationRuns.listAttention()) {
      if (run.conversationId) automationConversationIds.add(run.conversationId);
      // 原始授权或问题已进入列表，自动化不会为同一次等待再创建一个待办。
      if (run.conversationId && pendingConversations.has(run.conversationId)) continue;
      const task = this.ports.automationTasks.getById(run.automationId);
      const completed = run.status === 'succeeded';
      add({
        id: `automation:${run.id}`,
        projectId: run.projectId,
        title: task?.name ?? '自动化运行',
        summary: run.errorMessage ?? (completed ? '自动化已完成，可以查看本次结果。' : '本次自动化需要查看运行记录。'),
        kind: completed ? 'completed' : run.status === 'outcome_unknown' ? 'unknown' : 'failure',
        source: 'automation',
        sourceTitle: task?.name ?? '',
        createdAt: run.completedAt ?? run.createdAt,
        revision: run.updatedAt,
        blocking: false,
        bucket: completed ? 'activity' : 'pending',
        target: { kind: 'automation', runId: run.id },
      });
    }
    for (const conversation of conversations.values()) {
      if (conversation.archived || conversation.listingScope !== 'ordinary' || pendingConversations.has(conversation.id) || automationConversationIds.has(conversation.id)) continue;
      const waiting = conversation.stage === 'waiting_user' || conversation.stage === 'waiting_approval';
      const failed = (conversation.attentionKind === 'failed' || conversation.attentionKind === 'interrupted') && (conversation.stage === 'failed' || conversation.stage === 'paused' || conversation.providerState === 'failed');
      if (!waiting && !failed && !conversation.attentionUnread) continue;
      add({
        id: `conversation:${conversation.id}`,
        projectId: conversation.projectId,
        title: conversation.title,
        summary: conversation.summary ?? '',
        kind: waiting ? (conversation.stage === 'waiting_user' ? 'reply' : 'approval') : failed ? 'failure' : conversation.attentionKind === 'completed' ? 'completed' : 'update',
        source: 'conversation',
        sourceTitle: conversation.title,
        createdAt: waiting ? conversation.stageUpdatedAt : (conversation.attentionUpdatedAt ?? conversation.updatedAt),
        revision: `${conversation.stageUpdatedAt}:${conversation.attentionRevision}`,
        blocking: waiting,
        bucket: waiting || failed ? 'pending' : 'activity',
        target: { kind: 'conversation', conversationId: conversation.id, ...(conversation.attentionTurnId ? { turnId: conversation.attentionTurnId } : {}) },
      });
    }
    items.sort(
      (left, right) =>
        left.bucket.localeCompare(right.bucket) * -1 ||
        Number(right.blocking) - Number(left.blocking) ||
        (left.bucket === 'pending' && right.bucket === 'pending' ? left.createdAt.localeCompare(right.createdAt) : right.createdAt.localeCompare(left.createdAt)) ||
        left.id.localeCompare(right.id),
    );
    return { items, generatedAt };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) && value.every((part) => typeof part === 'string') ? value.join(' ') : '';
}
