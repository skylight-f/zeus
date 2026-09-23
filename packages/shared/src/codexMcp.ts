/** MCP 配置目录只返回展示元信息，不包含命令参数、环境变量或认证值。 */
export interface CodexMcpCatalog {
  sources: Array<{
    source: 'codex' | 'zeus';
    path: string;
    status: 'loaded' | 'missing' | 'invalid' | 'unreadable';
  }>;
  servers: Array<{
    name: string;
    source: 'codex' | 'zeus';
    enabled: boolean;
    transport: 'stdio' | 'http' | 'unknown';
    overridesCodex: boolean;
  }>;
}
