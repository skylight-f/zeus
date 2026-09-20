import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import type { McpConfigurationCatalog } from '@zeus/shared';

/** 两个 Home 各自展示，不合并配置，也不把外部启用误报成 Zeus 已接入。 */
export async function readMcpConfigurationCatalog(options: { codexHome?: string; sourceRoot?: string }): Promise<McpConfigurationCatalog> {
  const sources: Array<{ kind: 'zeus' | 'codex'; path: string }> = [];
  if (options.codexHome) sources.push({ kind: 'zeus', path: join(options.codexHome, 'config.toml') });
  if (options.sourceRoot && (!options.codexHome || resolve(options.sourceRoot) !== resolve(options.codexHome))) sources.push({ kind: 'codex', path: join(options.sourceRoot, 'config.toml') });
  const catalogs = await Promise.all(
    sources.map(async (source) => {
      let file;
      try {
        file = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return { source: { ...source, status: 'invalid' as const }, servers: [] };
        const config = parse(await file.readFile('utf8'));
        const servers = config.mcp_servers ?? {};
        if (!isRecord(servers)) return { source: { ...source, status: 'invalid' as const }, servers: [] };
        return {
          source: { ...source, status: 'loaded' as const },
          servers: Object.entries(servers).map(([name, value]): McpConfigurationCatalog['servers'][number] => {
            const server = isRecord(value) ? value : {};
            const transport = typeof server.command === 'string' && server.command.trim() ? 'stdio' : typeof server.url === 'string' && server.url.trim() ? 'http' : 'unknown';
            const validEnabled = server.enabled === undefined || typeof server.enabled === 'boolean';
            return { name, source: source.kind, transport, enabled: transport === 'unknown' || !validEnabled ? null : server.enabled !== false };
          }),
        };
      } catch (error) {
        // 解析异常可能包含带密钥的原文，接口只返回固定状态。
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        return { source: { ...source, status: code === 'ENOENT' ? ('missing' as const) : code ? ('unreadable' as const) : ('invalid' as const) }, servers: [] };
      } finally {
        await file?.close();
      }
    }),
  );
  return { sources: catalogs.map((result) => result.source), servers: catalogs.flatMap((result) => result.servers).sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}
