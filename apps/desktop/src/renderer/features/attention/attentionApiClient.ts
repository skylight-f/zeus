import type { AttentionSnapshot } from '@zeus/shared';
import type { LocalApiTransport } from '../../transport/localApiTransport.js';

export interface AttentionApiClient {
  loadAttention(): Promise<AttentionSnapshot>;
}

export function createAttentionApiClient(transport: LocalApiTransport): AttentionApiClient {
  return { loadAttention: () => transport.request<AttentionSnapshot>('/api/attention') };
}
