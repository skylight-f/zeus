/** 扩展页只接收配置展示元信息，不传递命令参数、环境变量或认证内容。 */
export interface McpConfigurationCatalog {
  sources: Array<{
    kind: 'zeus' | 'codex';
    path: string;
    status: 'loaded' | 'missing' | 'invalid' | 'unreadable';
  }>;
  servers: Array<{
    name: string;
    source: 'zeus' | 'codex';
    enabled: boolean | null;
    transport: 'stdio' | 'http' | 'unknown';
  }>;
}
