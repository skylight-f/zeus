import type { AttentionSnapshot, AttentionItemState, SetAttentionItemClosedInput } from '@zeus/shared';
import { jsonRequest, type LocalApiTransport } from '../../transport/localApiTransport.js';
import { buildSettingsCommandRequest, settingsClientCommandTypes } from '../settings/settingsCommandClient.js';

export interface AttentionApiClient {
  loadAttention(): Promise<AttentionSnapshot>;
  setAttentionItemClosed(input: SetAttentionItemClosedInput): Promise<AttentionItemState>;
}

export function createAttentionApiClient(transport: LocalApiTransport): AttentionApiClient {
  return {
    loadAttention: () => transport.request<AttentionSnapshot>('/api/attention'),
    setAttentionItemClosed: async (input) => {
      const body = await buildSettingsCommandRequest({ commandType: settingsClientCommandTypes.attentionItemStatePut, scopeKind: 'settings', scopeId: 'attention', operationPrefix: 'attention_item_state', value: input });
      return transport.request<AttentionItemState>('/api/attention/item-state', jsonRequest('PUT', body));
    },
  };
}
