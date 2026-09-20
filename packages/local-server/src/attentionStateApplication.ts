import type { AttentionItemState, AttentionSnapshot, SetAttentionItemClosedInput } from '@zeus/shared';
import type { SettingRepository } from '@zeus/storage';
import type { AttentionQueryApplication } from './attentionQueryApplication.js';
import { SettingsCommandApplicationError } from './settingsCommandApplication.js';

const closedItemsKey = 'attention.closed-items.v1';

/** 原业务状态负责发现事项，本机持久偏好只记录用户关闭的具体版本。 */
export class AttentionStateApplication {
  constructor(
    private readonly ports: {
      queries: Pick<AttentionQueryApplication, 'read'>;
      settings: Pick<SettingRepository, 'getJson' | 'setJson'>;
      now(): Date;
    },
  ) {}

  read(): AttentionSnapshot {
    const snapshot = this.ports.queries.read();
    const closed = this.readClosures();
    return {
      ...snapshot,
      items: snapshot.items.map((item) => {
        const state = closed.get(item.id);
        return { ...item, closedAt: item.bucket === 'pending' && state?.revision === item.revision ? state.closedAt : null };
      }),
    };
  }

  /** 调用方将偏好写入和命令回执放在同一事务；旧页面不能关闭新一轮事项。 */
  setClosed(input: SetAttentionItemClosedInput): AttentionItemState {
    if (
      !input ||
      typeof input.id !== 'string' ||
      !input.id.trim() ||
      input.id.length > 2_048 ||
      typeof input.revision !== 'string' ||
      !input.revision.trim() ||
      input.revision.length > 512 ||
      typeof input.closed !== 'boolean' ||
      Object.keys(input).some((key) => !['id', 'revision', 'closed'].includes(key))
    )
      throw new SettingsCommandApplicationError('ZEUS_SETTINGS_COMMAND_INVALID', '请提供待处理事项、读取版本及关闭状态。', 400);
    const item = this.ports.queries.read().items.find((candidate) => candidate.id === input.id);
    if (!item || item.revision !== input.revision || item.bucket !== 'pending') {
      throw new SettingsCommandApplicationError('ZEUS_SETTINGS_COMMAND_EXPLICITLY_REJECTED', '这条事项已处理或有新的变化，列表更新后请重试。', 409);
    }
    const closed = this.readClosures();
    const previous = closed.get(item.id);
    const state: AttentionItemState = {
      id: item.id,
      revision: item.revision,
      closedAt: input.closed ? (previous?.revision === item.revision && previous.closedAt ? previous.closedAt : this.ports.now().toISOString()) : null,
    };
    if (state.closedAt) closed.set(item.id, state);
    else closed.delete(item.id);
    this.ports.settings.setJson(closedItemsKey, [...closed.values()]);
    return state;
  }

  private readClosures(): Map<string, AttentionItemState> {
    const value = this.ports.settings.getJson<unknown>(closedItemsKey);
    const result = new Map<string, AttentionItemState>();
    if (!Array.isArray(value)) return result;
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.revision !== 'string' || typeof entry.closedAt !== 'string' || !Number.isFinite(Date.parse(entry.closedAt))) continue;
      result.set(entry.id, { id: entry.id, revision: entry.revision, closedAt: entry.closedAt });
    }
    return result;
  }
}
