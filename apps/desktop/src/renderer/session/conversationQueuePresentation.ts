import type { NativeQueuedSubmission, NativeQueueSnapshot, NativeSessionItemBuffer } from './sessionTypes.js';

/** 仅未确认接纳的本地消息进入待发区域；等待原生回显不等于仍在排队。 */
export function isUnacceptedTranscriptMessage(item: NativeSessionItemBuffer): boolean {
  if (!item.optimistic || item.providerItemId) return false;
  // 失败或暂停已经形成明确的历史结果，继续把它当作待发消息会在每次新事件排序时
  // 推到会话末尾，使错误看起来属于最新一条消息。
  if (item.status !== 'queued' && item.status !== 'dispatching' && item.status !== 'steering') return false;
  // 已交给当前轮次的引导消息沿用发言位置，不能等待原生回显才退出队尾。
  return !(item.payload.delivery === 'steer_now' && item.status === 'steering');
}

const anchoredPausedReasons = new Set([
  'configuration_mismatch',
  'conflict_preparation_failed',
  'interrupted',
  'outcome_unknown',
  'preflight_failed',
  'recovered_unsent',
  'recovery_required',
  'runtime_rejected',
  'semantic_route_changed',
  'upgrade_interrupted',
  'user_confirmation',
]);

/** 只有仍会继续交接 Provider 的消息留在队尾；已有失败结论的消息属于发生时的历史。 */
export function isPendingQueueTranscriptMessage(item: NativeSessionItemBuffer): boolean {
  if (!isUnacceptedTranscriptMessage(item)) return false;
  const status = item.status.toLocaleLowerCase();
  if (status === 'failed' || status === 'unconfirmed') return false;
  if (status !== 'paused') return true;
  if (item.payload.deliveryError || item.payload.error) return false;
  const pausedReason = typeof item.payload.pausedReason === 'string' ? item.payload.pausedReason : null;
  return !pausedReason || !anchoredPausedReasons.has(pausedReason);
}

/** 首次发送时间只用于把已停止推进的本地消息插回历史，不重排已有持久正文。 */
function insertAnchoredTranscriptMessage(items: NativeSessionItemBuffer[], item: NativeSessionItemBuffer): void {
  const timestamp = item.timelineAt ?? item.updatedAt;
  if (!timestamp) {
    items.push(item);
    return;
  }
  const index = items.findIndex((candidate) => {
    const candidateTimestamp = candidate.timelineAt ?? candidate.updatedAt;
    return Boolean(candidateTimestamp && candidateTimestamp > timestamp);
  });
  if (index < 0) items.push(item);
  else items.splice(index, 0, item);
}

/** 待发送消息按权威队列顺序留在记录末尾；失败或需处理的旧消息固定在首次发送位置。 */
export function orderTranscriptItemsWithQueue(items: readonly NativeSessionItemBuffer[], queue: NativeQueueSnapshot | null): NativeSessionItemBuffer[] {
  /** 提交与客户端消息身份共同覆盖本地气泡和冷开队列投影。 */
  const positions = new Map<string, number>();
  /** 失败提交仍占据原发送位置；已结束历史则由条目的原生身份排除。 */
  const submissions = [...(queue?.submissions ?? [])].sort((left, right) => left.position - right.position || (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.id.localeCompare(right.id));
  submissions.forEach((submission, index) => {
    positions.set(submission.id, index);
    if (submission.clientUserMessageId) positions.set(submission.clientUserMessageId, index);
  });
  /** 队尾只包含仍在推进的消息，失败记录不能被后续发言反复推成最新一条。 */
  const queuePosition = (item: NativeSessionItemBuffer): number | undefined => {
    if (!isPendingQueueTranscriptMessage(item)) return undefined;
    for (const id of [item.payload.submissionId, item.clientUserMessageId, item.durableClientUserMessageId]) {
      if (typeof id === 'string' && positions.has(id)) return positions.get(id);
    }
    // 本地消息尚无队列回执时，也必须排在既有待发消息之后。
    return submissions.length;
  };
  const historicalItems: NativeSessionItemBuffer[] = [];
  const anchoredItems: NativeSessionItemBuffer[] = [];
  const pendingItems: NativeSessionItemBuffer[] = [];
  for (const item of items) {
    if (queuePosition(item) !== undefined) pendingItems.push(item);
    else if (isUnacceptedTranscriptMessage(item)) anchoredItems.push(item);
    else historicalItems.push(item);
  }
  /** 本地失败项可能来自冷开队列投影，先移出队尾，再按首次发送时间逐条归位。 */
  anchoredItems.sort((left, right) => (left.timelineAt ?? left.updatedAt ?? '').localeCompare(right.timelineAt ?? right.updatedAt ?? '')).forEach((item) => insertAnchoredTranscriptMessage(historicalItems, item));
  pendingItems.sort((left, right) => {
    const leftPosition = queuePosition(left)!;
    const rightPosition = queuePosition(right)!;
    /** 同时等待本地回执时按首次显示时间排序，状态更新时间不能移动气泡。 */
    return leftPosition - rightPosition || (left.timelineAt ?? '').localeCompare(right.timelineAt ?? '');
  });
  return [...historicalItems, ...pendingItems];
}

/** 沿用提交的稳定队列顺序，保留模型接手前的消息及发送失败后的重试入口。 */
export function visibleQueuedSubmissions(queue: NativeQueueSnapshot | null): NativeQueuedSubmission[] {
  return [...(queue?.submissions ?? [])]
    .filter((submission) => submission.status === 'paused' || ((submission.status === 'queued' || submission.status === 'dispatching' || submission.status === 'steering' || submission.status === 'failed') && !submission.providerTurnId))
    .sort((left, right) => left.position - right.position || (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.id.localeCompare(right.id));
}

/** 只有被当前轮次、前序消息或明确等待原因阻塞的提交才展示排队；空闲队首正在交接发送。 */
export function isSubmissionWaitingInQueue(queue: NativeQueueSnapshot | null, submission: NativeQueuedSubmission | null): boolean {
  if (!queue || !submission || submission.providerTurnId) return false;
  if (submission.status === 'paused') return true;
  if (submission.status !== 'queued') return false;
  if (queue.state.type === 'dispatching') return queue.state.submissionId !== submission.id;
  return queue.state.type !== 'idle' || Boolean(queue.waitReason && queue.waitReason !== 'dispatch_pending') || visibleQueuedSubmissions(queue)[0]?.id !== submission.id;
}
