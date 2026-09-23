import { useEffect, useState } from 'react';
import { ArrowClockwiseIcon as ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { Button, type CodexMcpCatalog as Catalog, type NativeConversationAppClient } from '../toolPageHost.js';

/** 原生 MCP 独立于插件注册表，目录只展示配置事实，不宣称连接成功。 */
export function CodexMcpCatalog(props: { client: Pick<NativeConversationAppClient, 'loadCodexMcpServers'> | null; zh: boolean }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setCatalog(null);
    setFailed(false);
    setLoading(false);
    if (!props.client) return;
    setLoading(true);
    void props.client
      .loadCodexMcpServers()
      .then(
        (result) => {
          if (!disposed) setCatalog(result);
        },
        () => {
          if (!disposed) setFailed(true);
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [props.client, refresh]);

  const sourceLabel = (source: 'codex' | 'zeus') => (source === 'codex' ? (props.zh ? '原 Codex 配置' : 'Original Codex config') : props.zh ? 'Zeus 专属配置' : 'Zeus config');
  return (
    <section className="skills-catalog extension-catalog" aria-label={props.zh ? 'Codex MCP 服务' : 'Codex MCP servers'} aria-busy={loading}>
      <div className="skills-section-heading">
        <div>
          <h2>{props.zh ? 'Codex MCP 服务' : 'Codex MCP servers'}</h2>
          <p>
            {props.zh
              ? '自动读取原 Codex 与 Zeus 专属配置，同名服务以 Zeus 配置为准。新建或重新连接的 Codex 会话会读取最新配置。'
              : 'Read the original Codex and Zeus configurations automatically. Zeus wins for duplicate names. New or reconnected Codex conversations read the latest configuration.'}
          </p>
          <p>
            {props.zh
              ? '这里显示配置启用状态，连接结果请查看会话运行详情。插件附带的 MCP 在「插件」页管理。'
              : 'These are configuration states; check conversation runtime details for connection results. Plugin MCP servers are managed on the Plugins tab.'}
          </p>
        </div>
        <Button variant="secondary" size="regular" busy={loading} disabled={!props.client || loading} onClick={() => setRefresh((value) => value + 1)}>
          <ArrowClockwise aria-hidden="true" /> {props.zh ? '刷新' : 'Refresh'}
        </Button>
      </div>
      {loading ? <p role="status">{props.zh ? '正在读取 MCP 配置…' : 'Reading MCP configuration…'}</p> : null}
      {failed ? (
        <p role="alert" className="skills-inline-error">
          {props.zh ? 'MCP 配置读取失败，请刷新重试。' : 'Could not read MCP configuration. Refresh to retry.'}
        </p>
      ) : null}
      {catalog ? (
        <>
          <dl className="extension-mcp-sources">
            {catalog.sources.map((source) => (
              <div key={source.path}>
                <dt>{sourceLabel(source.source)}</dt>
                <dd>
                  <code>{source.path}</code>
                  {source.status === 'missing' ? <span> · {props.zh ? '文件不存在' : 'File not found'}</span> : null}
                </dd>
                {source.status === 'invalid' || source.status === 'unreadable' ? (
                  <dd className="skills-inline-error" role="alert">
                    {props.zh ? '配置格式无效或文件不可读取，请修复此文件后重试。' : 'Invalid or unreadable configuration. Fix this file and retry.'}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
          {catalog.servers.length === 0 ? (
            <p>{props.zh ? '尚未发现 MCP 服务配置。' : 'No MCP server configuration found.'}</p>
          ) : (
            <ul className="extension-mcp-list">
              {catalog.servers.map((server) => (
                <li className="extension-component-row" key={server.name}>
                  <span>
                    <strong>{server.name}</strong>
                    <small>
                      {sourceLabel(server.source)} · {server.transport === 'unknown' ? (props.zh ? '连接方式未指定' : 'Unspecified transport') : server.transport.toUpperCase()}
                      {server.overridesCodex ? (props.zh ? ' · 覆盖原 Codex 同名配置' : ' · Overrides the original Codex configuration') : ''}
                    </small>
                  </span>
                  <span>{server.enabled ? (props.zh ? '配置已启用' : 'Enabled in config') : props.zh ? '已停用' : 'Disabled'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
