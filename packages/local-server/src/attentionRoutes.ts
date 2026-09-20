import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SetAttentionItemClosedInput } from '@zeus/shared';
import type { AttentionStateApplication } from './attentionStateApplication.js';
import { type SettingsCommandApplication, type SettingsCommandRequest, settingsCommandHttpError, settingsCommandTypes } from './settingsCommandApplication.js';

/** 关闭和恢复共用现有持久命令入口，不调用会话回复、授权或任务取消接口。 */
export function registerAttentionRoutes(options: {
  server: FastifyInstance;
  application: AttentionStateApplication;
  commands: SettingsCommandApplication;
  publish(type: string, payload: Record<string, unknown>): unknown;
  redactSensitiveText(value: string): { text: string };
}): void {
  options.server.get('/api/attention', async () => options.application.read());
  options.server.put('/api/attention/item-state', async (request: FastifyRequest<{ Body: SettingsCommandRequest<SetAttentionItemClosedInput> }>, reply) => {
    try {
      const parsed = options.commands.parse<SetAttentionItemClosedInput>({
        value: request.body,
        commandType: settingsCommandTypes.attentionItemStatePut,
        scopeKind: 'settings',
        expectedScopeId: () => 'attention',
      });
      const mutation = options.commands.executeCore({
        parsed,
        destinationId: 'attention_item_state',
        resourceId: parsed.input.id,
        mutateBusinessState: () => options.application.setClosed(parsed.input),
      });
      // 持久事务和回执成功后才通知其他窗口，重放不重复广播。
      if (!mutation.replayed) options.publish('attention.item.updated', { ...mutation.result });
      return mutation.result;
    } catch (error) {
      const mapped = settingsCommandHttpError(error, options.redactSensitiveText);
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });
}
