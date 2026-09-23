import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import type { CodexMcpCatalog } from '@zeus/shared';

type ConfigValue = null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue };
type ServerConfiguration = Record<string, ConfigValue>;

/** 原 Codex Home 只作 MCP 来源；账号、历史和其他配置仍由 Zeus 独立管理。 */
export function createCodexMcpConfiguration(options: { sourceRoot?: string; codexHome: string; toolRuntimeCodexHome: string }) {
  const paths: Array<{ source: 'codex' | 'zeus'; path: string }> = [];
  if (options.sourceRoot && resolve(options.sourceRoot) !== resolve(options.codexHome)) paths.push({ source: 'codex', path: join(options.sourceRoot, 'config.toml') });
  paths.push({ source: 'zeus', path: join(options.codexHome, 'config.toml') });

  async function read() {
    const sources: CodexMcpCatalog['sources'] = [];
    const servers = new Map<string, { source: 'codex' | 'zeus'; config: ServerConfiguration; overridesCodex: boolean }>();
    for (const source of paths) {
      const result = await readServers(source.path);
      sources.push({ ...source, status: result.status });
      for (const [name, config] of Object.entries(result.servers)) {
        servers.set(name, { source: source.source, config, overridesCodex: source.source === 'zeus' && servers.has(name) });
      }
    }
    return { sources, servers };
  }

  return {
    async inspect(): Promise<CodexMcpCatalog> {
      const { sources, servers } = await read();
      return {
        sources,
        servers: [...servers]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, server]) => ({
            name,
            source: server.source,
            enabled: server.config.enabled !== false,
            transport: typeof server.config.command === 'string' ? 'stdio' : typeof server.config.url === 'string' ? 'http' : 'unknown',
            overridesCodex: server.overridesCodex,
          })),
      };
    },
    /** 经本地 RPC 传递配置，避免把 MCP 凭据写入 argv、日志或新的配置文件。 */
    async threadConfig(nativeMcpServers?: unknown): Promise<Record<string, ConfigValue>> {
      const { sources, servers } = await read();
      if (sources.some((source) => source.status === 'invalid' || source.status === 'unreadable')) {
        // TOML 解析异常可能包含带密钥的原文，因此只返回固定的诊断文本。
        throw Object.assign(new Error('无法读取 Codex MCP 配置，请在扩展管理的 MCP 服务页检查配置文件。'), { code: 'ZEUS_CODEX_MCP_CONFIG_INVALID' });
      }
      // 没有需要继承的配置时保留 Codex 原有的配置加载与项目覆盖规则。
      if (![...servers.values()].some((server) => server.source === 'codex')) return {};
      const merged = Object.fromEntries([...servers].map(([name, server]) => [name, server.config]));
      // Codex 自己解析可信项目、profile 和启动参数；这些配置都优先于外部 Home。
      if (nativeMcpServers !== undefined && nativeMcpServers !== null) {
        if (!isRecord(nativeMcpServers) || !Object.values(nativeMcpServers).every((server) => isRecord(server) && isConfigValue(server))) {
          throw Object.assign(new Error('Codex 返回的 MCP 配置格式不受支持。'), { code: 'ZEUS_CODEX_MCP_CONFIG_INVALID' });
        }
        for (const [name, config] of Object.entries(nativeMcpServers)) merged[name] = config as ServerConfiguration;
      }
      if (merged.node_repl) {
        merged.node_repl = { ...merged.node_repl, env: { ...(isRecord(merged.node_repl.env) ? merged.node_repl.env : {}), CODEX_HOME: options.toolRuntimeCodexHome } };
      }
      return { mcp_servers: merged };
    },
  };
}

/** 按文件大小限制读取；解析失败时不回传可能含凭据的 TOML 原文。 */
async function readServers(path: string): Promise<{ status: CodexMcpCatalog['sources'][number]['status']; servers: Record<string, ServerConfiguration> }> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return { status: 'invalid', servers: {} };
    const parsed = parse(await file.readFile('utf8'));
    const servers = parsed.mcp_servers ?? {};
    if (!isRecord(servers) || !Object.values(servers).every((server) => isRecord(server) && isConfigValue(server))) return { status: 'invalid', servers: {} };
    return { status: 'loaded', servers: servers as Record<string, ServerConfiguration> };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    return { status: code === 'ENOENT' ? 'missing' : code ? 'unreadable' : 'invalid', servers: {} };
  } finally {
    await file?.close();
  }
}

function isRecord(value: unknown): value is Record<string, ConfigValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function isConfigValue(value: unknown): value is ConfigValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isConfigValue);
  return isRecord(value) && Object.values(value).every(isConfigValue);
}
