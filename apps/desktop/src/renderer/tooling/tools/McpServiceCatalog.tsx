import { useEffect, useState } from 'react';
import { Button, ZeusSelect, type McpConfigurationCatalog, type NativeConversationAppClient, type PluginDescriptor } from '../toolPageHost.js';

type ServiceRow = {
  id: string;
  name: string;
  source: 'plugin' | 'zeus' | 'codex';
  sourceName: string;
  transport: string;
  enabled: boolean | null;
  restricted?: boolean;
  unavailable?: boolean;
  pluginId?: string;
};

/** MCP 目录与插件列表并列展示；配置启用不等于某个会话已连接。 */
export function McpServiceCatalog(props: {
  client: Pick<NativeConversationAppClient, 'loadMcpConfiguration'> | null;
  plugins: PluginDescriptor[];
  refreshRevision: number;
  pluginsLoading: boolean;
  pluginsFailed: boolean;
  zh: boolean;
  onManagePlugin(id: string): void;
}) {
  const [catalog, setCatalog] = useState<McpConfigurationCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState('all');
  const [showDisabled, setShowDisabled] = useState(false);
  const zh = props.zh;
  useEffect(() => {
    let active = true;
    setCatalog(null);
    setFailed(false);
    setLoading(Boolean(props.client));
    if (!props.client) return;
    void props.client
      .loadMcpConfiguration()
      .then(
        (next) => {
          if (active) setCatalog(next);
        },
        () => {
          if (active) setFailed(true);
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.client, props.refreshRevision]);

  const sourceLabel = (kind: ServiceRow['source']) => (kind === 'plugin' ? (zh ? 'Zeus 插件' : 'Zeus plugin') : kind === 'zeus' ? (zh ? 'Zeus 全局配置' : 'Zeus global config') : zh ? '外部 Codex 配置' : 'External Codex config');
  const pluginRows = props.plugins.flatMap((descriptor) => {
    const servers = [
      ...descriptor.revision.components.mcpServers.map((server) => ({ id: server.id, name: server.name, transport: server.transport })),
      ...descriptor.connectors
        .filter((connector) => connector.connected && !descriptor.revision.components.mcpServers.some((server) => server.id === connector.connectorId))
        .map((connector) => ({
          id: connector.connectorId,
          name: connector.appTechnicalId,
          transport: typeof connector.serverConfig.command === 'string' ? 'stdio' : typeof connector.serverConfig.url === 'string' ? 'http' : 'unknown',
        })),
    ];
    return servers.map((server): ServiceRow => {
      const policies = descriptor.mcpPolicies.filter((policy) => policy.serverId === server.id);
      const wildcard = policies.find((policy) => policy.toolName === '*');
      const enabled = descriptor.plugin.enabled && (wildcard?.enabled !== false || policies.some((policy) => policy.toolName !== '*' && policy.enabled));
      return {
        id: `${descriptor.plugin.id}:${server.id}`,
        name: server.name,
        source: 'plugin',
        sourceName: descriptor.plugin.displayName || descriptor.plugin.name,
        transport: server.transport,
        enabled,
        restricted: policies.some((policy) => !policy.enabled || policy.approvalMode === 'deny'),
        unavailable: descriptor.plugin.connectionState !== 'ready',
        pluginId: descriptor.plugin.id,
      };
    });
  });
  const rows: ServiceRow[] = [
    ...pluginRows,
    ...(catalog?.servers ?? []).map((server) => ({ id: `${server.source}:${server.name}`, name: server.name, source: server.source, sourceName: sourceLabel(server.source), transport: server.transport, enabled: server.enabled })),
  ];
  const scoped = rows.filter((row) => source === 'all' || row.source === source);
  const visible = scoped.filter((row) => showDisabled || row.enabled !== false);
  const busy = loading || props.pluginsLoading;
  const hasError = failed || props.pluginsFailed || catalog?.sources.some((item) => item.status === 'invalid' || item.status === 'unreadable');

  return (
    <section className="skills-catalog extension-catalog extension-mcp-catalog" aria-label={zh ? 'MCP 服务' : 'MCP services'} aria-busy={busy}>
      <div className="skills-section-heading">
        <div>
          <h2>{zh ? 'MCP 服务' : 'MCP services'}</h2>
          <p>
            {zh
              ? '查看插件与全局配置中的 MCP。启用状态来自配置，实际连接结果以会话运行详情为准。'
              : 'MCP services from plugins and global configuration. Enablement comes from configuration; check conversation runtime details for connection results.'}
          </p>
        </div>
        <span className="extension-mcp-count">
          {scoped.filter((row) => row.enabled).length} {zh ? '项配置已启用' : 'enabled configurations'}
        </span>
      </div>
      <div className="extension-mcp-filters">
        <ZeusSelect
          value={source}
          onChange={setSource}
          ariaLabel={zh ? '筛选 MCP 来源' : 'Filter MCP sources'}
          size="compact"
          options={[{ value: 'all', label: zh ? '全部来源' : 'All sources' }, ...(['plugin', 'zeus', 'codex'] as const).map((kind) => ({ value: kind, label: sourceLabel(kind) }))]}
        />
        <label>
          <input type="checkbox" checked={showDisabled} onChange={(event) => setShowDisabled(event.currentTarget.checked)} /> {zh ? '显示停用项' : 'Show disabled'}
        </label>
      </div>
      {visible.some((row) => row.source === 'codex') ? (
        <p className="extension-mcp-source-note">{zh ? '外部 Codex 配置独立保存，启用不代表 Zeus 会话已加载。' : 'External Codex configuration is separate; enabling it does not mean a Zeus conversation has loaded it.'}</p>
      ) : null}
      {!props.client ? <p role="status">{zh ? '本地服务尚未连接。' : 'The local service is not connected.'}</p> : null}
      {busy ? <p role="status">{zh ? '正在读取 MCP 配置…' : 'Reading MCP configuration…'}</p> : null}
      {failed ? (
        <p className="skills-inline-error" role="alert">
          {zh ? 'MCP 配置读取失败，请使用页面上方的刷新按钮重试。' : 'Could not read MCP configuration. Use Refresh above to retry.'}
        </p>
      ) : null}
      {props.pluginsFailed ? (
        <p className="skills-inline-error" role="status">
          {zh ? '插件服务列表暂未更新；以下保留上次结果。' : 'Plugin services could not be refreshed; showing the last result.'}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="extension-mcp-list">
          {visible.map((row) => (
            <li key={row.id} className="extension-component-row">
              <span>
                <strong>{row.name}</strong>
                <small>
                  {sourceLabel(row.source)}
                  {row.source === 'plugin' ? ` · ${row.sourceName}` : ''} · {row.transport === 'unknown' ? (zh ? '连接方式未指定' : 'Unspecified transport') : row.transport.toUpperCase()}
                </small>

                {row.unavailable ? <small>{zh ? '所属插件尚未就绪，请查看插件详情。' : 'The plugin is not ready. Check its details.'}</small> : null}
              </span>
              <span>
                <span>
                  {row.enabled === null ? (zh ? '配置需检查' : 'Check configuration') : row.enabled ? (zh ? '配置已启用' : 'Enabled in config') : zh ? '已停用' : 'Disabled'}
                  {row.restricted && row.enabled ? (zh ? ' · 有工具限制' : ' · Tool restrictions') : ''}
                </span>
                {row.pluginId ? (
                  <Button variant="secondary" size="compact" onClick={() => props.onManagePlugin(row.pluginId!)}>
                    {zh ? '插件详情' : 'Plugin details'}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : !busy && props.client && catalog && !hasError ? (
        <p className="skills-empty-state">{showDisabled ? (zh ? '此来源没有 MCP 服务配置。' : 'No MCP configuration for this source.') : zh ? '此来源没有已启用的 MCP 配置。' : 'No enabled MCP configuration for this source.'}</p>
      ) : null}
      {catalog ? (
        <details className="extension-mcp-sources">
          <summary>{zh ? '配置文件来源' : 'Configuration files'}</summary>
          <dl>
            {catalog.sources.map((item) => (
              <div key={item.path}>
                <dt>{sourceLabel(item.kind)}</dt>
                <dd>
                  <code>{item.path}</code>
                  {item.status === 'missing' ? (zh ? ' · 文件不存在' : ' · File not found') : null}
                </dd>
                {item.status === 'invalid' || item.status === 'unreadable' ? (
                  <dd role="alert" className="skills-inline-error">
                    {zh ? '配置格式无效或不可读取，请修复后刷新。' : 'Invalid or unreadable configuration. Fix it and refresh.'}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
