import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Client, StreamableHTTPClientTransport, type Tool } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { PiDynamicToolSpec } from '@zeus/ai-runtime';
import { parse } from 'smol-toml';

const maximumConfigBytes = 4 * 1024 * 1024;
const maximumToolResultBytes = 8 * 1024 * 1024;
const defaultStartupTimeoutMs = 10_000;
const defaultToolTimeoutMs = 60_000;

export interface ZeusConfiguredMcpTool {
  name: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  originalToolName: string;
  definitionSha256: string;
  toolTimeoutMs: number;
  /** MCP 明确声明的只读能力；缺失时不能在只读模式执行。 */
  readOnly?: boolean;
}

export interface ZeusConfiguredMcpToolResult {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  structuredContent: unknown;
  isError: boolean;
}

export interface ZeusConfiguredMcpCatalog {
  tools: ZeusConfiguredMcpTool[];
  failures: Array<{ serverId: string; error: string }>;
  snapshotSha256: string;
}

export interface ZeusConfiguredMcpPreparation {
  catalog: ZeusConfiguredMcpCatalog;
  piDynamicTools: PiDynamicToolSpec[];
  developerInstructions: string;
}

export interface ZeusConfiguredMcpRuntime {
  prepare(conversationId: string): Promise<ZeusConfiguredMcpPreparation>;
  getCatalog(conversationId: string): Promise<ZeusConfiguredMcpCatalog>;
  invoke(input: { conversationId: string; toolName: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<ZeusConfiguredMcpToolResult>;
  closeConversation(conversationId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Codex 继续原生读取同一份 config.toml；Pi 通过该宿主桥接普通 MCP。
 * 配置、工具定义和连接都按会话首次准备冻结，避免运行中改配置污染旧会话。
 */
export function createZeusConfiguredMcpRuntime(options: { codexHome: string; publish?: (type: string, payload: Record<string, unknown>) => void }): ZeusConfiguredMcpRuntime {
  if (!isAbsolute(options.codexHome)) throw configuredMcpError('ZEUS_CONFIGURED_MCP_HOME_INVALID', 'Zeus Codex Home 必须是绝对路径。');
  const states = new Map<string, Promise<ConversationMcpState>>();
  const connections = new Map<string, Promise<McpConnection>>();
  let statusSequence = 0;

  async function prepare(conversationId: string): Promise<ZeusConfiguredMcpPreparation> {
    return (await requireState(conversationId)).preparation;
  }

  async function getCatalog(conversationId: string): Promise<ZeusConfiguredMcpCatalog> {
    return (await requireState(conversationId)).preparation.catalog;
  }

  async function requireState(conversationId: string): Promise<ConversationMcpState> {
    const existing = states.get(conversationId);
    if (existing) return existing;
    const pending = buildState(conversationId).catch(async (error) => {
      states.delete(conversationId);
      await closeConnections(conversationId);
      throw error;
    });
    states.set(conversationId, pending);
    return pending;
  }

  async function buildState(conversationId: string): Promise<ConversationMcpState> {
    const snapshot = await readConfiguredMcpSnapshot(join(options.codexHome, 'config.toml'));
    const statuses: Record<string, string | { status: string; error?: string }> = {};
    const failures: ZeusConfiguredMcpCatalog['failures'] = [];
    const tools: ZeusConfiguredMcpTool[] = [];
    const results = await Promise.all(
      snapshot.servers.map(async (server) => {
        if (!server.enabled) return { server, connection: null, error: null };
        try {
          return { server, connection: await requireConnection(conversationId, server), error: null };
        } catch (error) {
          return { server, connection: null, error };
        }
      }),
    );
    let requiredFailure: { serverId: string; error: string } | null = null;
    for (const result of results) {
      if (!result.server.enabled) {
        statuses[result.server.id] = 'disabled';
        continue;
      }
      if (result.error || !result.connection) {
        const failure = { serverId: result.server.id, error: safeErrorMessage(result.error) };
        failures.push(failure);
        statuses[result.server.id] = { status: 'failed', error: failure.error };
        if (result.server.required && !requiredFailure) requiredFailure = failure;
        continue;
      }
      statuses[result.server.id] = 'ready';
      for (const definition of result.connection.tools) {
        if (!toolEnabled(result.server, definition.name) || toolVisibility(definition) === 'app') continue;
        const name = configuredToolName(result.server.id, definition.name);
        if (tools.some((candidate) => candidate.name === name)) {
          throw configuredMcpError('ZEUS_CONFIGURED_MCP_TOOL_CONFLICT', `普通 MCP 工具身份重名：${name}`);
        }
        tools.push({
          name,
          label: boundedText(definition.title?.trim() || `${result.server.id}/${definition.name}`, 240),
          description: boundedText(definition.description?.trim() || `调用 ${result.server.id} 的 ${definition.name} MCP 工具。`, 8_000),
          inputSchema: normalizeInputSchema(definition.inputSchema),
          readOnly: definition.annotations?.readOnlyHint === true,
          serverId: result.server.id,
          originalToolName: definition.name,
          definitionSha256: toolDefinitionSha256(definition),
          toolTimeoutMs: result.server.toolTimeoutMs,
        });
      }
    }
    tools.sort((left, right) => left.name.localeCompare(right.name));
    const catalog = { tools, failures, snapshotSha256: snapshot.sha256 } satisfies ZeusConfiguredMcpCatalog;
    options.publish?.('conversation.mcpStartup.changed', {
      conversationId,
      agentKind: 'pi',
      generationId: `pi-mcp-${snapshot.sha256.slice(0, 24)}`,
      sequence: ++statusSequence,
      value: statuses,
    });
    if (requiredFailure) {
      throw configuredMcpError('ZEUS_CONFIGURED_MCP_REQUIRED_SERVER_FAILED', `必需的普通 MCP 服务 ${requiredFailure.serverId} 启动失败：${requiredFailure.error}`);
    }
    const piDynamicTools = tools.map(
      (tool): PiDynamicToolSpec => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        inputSchema: tool.inputSchema,
        executionMode: 'sequential',
        deferLoading: true,
      }),
    );
    const developerInstructions =
      tools.length > 0
        ? `当前 Pi 会话已从 Zeus Codex 配置冻结 ${tools.length} 个普通 MCP 工具；名称与 Codex 一致。请先用 zeus_tool_catalog 查阅参数，再用 zeus_tool_invoke 调用：\n${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`
        : '';
    return { snapshot, preparation: { catalog, piDynamicTools, developerInstructions } };
  }

  async function requireConnection(conversationId: string, server: ConfiguredMcpServer): Promise<McpConnection> {
    const key = connectionKey(conversationId, server.id);
    const existing = connections.get(key);
    if (existing) return existing;
    const pending = connect(server).catch((error) => {
      connections.delete(key);
      throw error;
    });
    connections.set(key, pending);
    return pending;
  }

  async function connect(server: ConfiguredMcpServer): Promise<McpConnection> {
    if (server.unsupportedReason) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_UNSUPPORTED', server.unsupportedReason);
    const client = new Client({ name: 'zeus-configured-mcp-host', version: '1.0.0' }, { enforceStrictCapabilities: true, listMaxPages: 64 });
    const transport =
      server.transport === 'stdio'
        ? createStdioTransport(server)
        : new StreamableHTTPClientTransport(new URL(server.url), {
            requestInit: { headers: configuredHttpHeaders(server) },
            reconnectionOptions: { maxReconnectionDelay: 10_000, initialReconnectionDelay: 1_000, reconnectionDelayGrowFactor: 1.5, maxRetries: 0 },
          });
    if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => undefined);
    try {
      await client.connect(transport, { timeout: server.startupTimeoutMs });
      const listed = await client.listTools(undefined, { timeout: server.startupTimeoutMs });
      return { client, tools: listed.tools, transport };
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async function invoke(input: { conversationId: string; toolName: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<ZeusConfiguredMcpToolResult> {
    const state = await requireState(input.conversationId);
    const tool = state.preparation.catalog.tools.find((candidate) => candidate.name === input.toolName);
    if (!tool) throw configuredMcpError('ZEUS_CONFIGURED_MCP_TOOL_NOT_FOUND', '当前 Pi 会话的冻结普通 MCP 目录中不存在该工具。');
    const server = state.snapshot.servers.find((candidate) => candidate.id === tool.serverId);
    if (!server) throw configuredMcpError('ZEUS_CONFIGURED_MCP_SERVER_NOT_FOUND', '普通 MCP 工具对应的冻结服务不存在。');
    const connection = await requireConnection(input.conversationId, server);
    const definition = connection.tools.find((candidate) => candidate.name === tool.originalToolName);
    if (!definition || toolDefinitionSha256(definition) !== tool.definitionSha256) {
      throw configuredMcpError('ZEUS_CONFIGURED_MCP_TOOL_CHANGED', '普通 MCP 工具定义在会话期间发生漂移；Zeus 不会在旧会话中采用新定义。');
    }
    const result = await connection.client.callTool({ name: tool.originalToolName, arguments: structuredClone(input.args) }, { ...(input.signal ? { signal: input.signal } : {}), timeout: tool.toolTimeoutMs, toolDefinition: definition });
    return {
      text: toolResultText(result),
      images: toolResultImages(result.content),
      structuredContent: result.structuredContent,
      isError: result.isError === true,
    };
  }

  async function closeConnections(conversationId: string): Promise<void> {
    const prefix = `${conversationId}\u0000`;
    const targets = [...connections.entries()].filter(([key]) => key.startsWith(prefix));
    await Promise.allSettled(
      targets.map(async ([key, pending]) => {
        connections.delete(key);
        const connection = await pending;
        await connection.client.close();
      }),
    );
  }

  async function closeConversation(conversationId: string): Promise<void> {
    states.delete(conversationId);
    await closeConnections(conversationId);
  }

  async function close(): Promise<void> {
    const conversationIds = new Set([...connections.keys()].map((key) => key.slice(0, key.indexOf('\u0000'))));
    await Promise.all([...conversationIds].map(closeConversation));
    states.clear();
  }

  return { prepare, getCatalog, invoke, closeConversation, close };
}

interface ConversationMcpState {
  snapshot: ConfiguredMcpSnapshot;
  preparation: ZeusConfiguredMcpPreparation;
}

interface ConfiguredMcpSnapshot {
  sha256: string;
  servers: ConfiguredMcpServer[];
}

type ConfiguredMcpServer =
  | (ConfiguredMcpServerBase & {
      transport: 'stdio';
      command: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
      envVars: string[];
    })
  | (ConfiguredMcpServerBase & {
      transport: 'http';
      url: string;
      httpHeaders: Record<string, string>;
      envHttpHeaders: Record<string, string>;
      bearerTokenEnvVar?: string;
    });

interface ConfiguredMcpServerBase {
  id: string;
  enabled: boolean;
  required: boolean;
  unsupportedReason?: string;
  startupTimeoutMs: number;
  toolTimeoutMs: number;
  enabledTools: Set<string> | null;
  disabledTools: Set<string>;
}

type McpConnection = { client: Client; tools: Tool[]; transport: StdioClientTransport | StreamableHTTPClientTransport };

async function readConfiguredMcpSnapshot(configPath: string): Promise<ConfiguredMcpSnapshot> {
  let file;
  try {
    file = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumConfigBytes) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', 'Zeus Codex 配置不是普通文件或超过 4 MiB。');
    const source = await file.readFile('utf8');
    let document: Record<string, unknown>;
    try {
      const parsed = parse(source);
      if (!isRecord(parsed)) throw new Error('root');
      document = parsed;
    } catch {
      throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', 'Zeus Codex config.toml 无法解析。');
    }
    const rawServers = document.mcp_servers;
    if (rawServers !== undefined && !isRecord(rawServers)) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', 'mcp_servers 必须是 TOML 表。');
    const servers = Object.entries(rawServers ?? {}).map(([id, value]) => parseConfiguredServer(id, value));
    return { sha256: createHash('sha256').update(source).digest('hex'), servers };
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return { sha256: createHash('sha256').update('missing').digest('hex'), servers: [] };
    throw error;
  } finally {
    await file?.close();
  }
}

function parseConfiguredServer(id: string, value: unknown): ConfiguredMcpServer {
  if (!id.trim() || id.includes('\0')) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', '普通 MCP 服务名称无效。');
  if (!isRecord(value)) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `普通 MCP 服务 ${id} 必须是 TOML 表。`);
  const enabled = optionalBoolean(value.enabled, `${id}.enabled`, true);
  const required = optionalBoolean(value.required, `${id}.required`, false);
  const base: ConfiguredMcpServerBase = {
    id,
    enabled,
    required,
    startupTimeoutMs: optionalSeconds(value.startup_timeout_sec, `${id}.startup_timeout_sec`, defaultStartupTimeoutMs),
    toolTimeoutMs: optionalSeconds(value.tool_timeout_sec, `${id}.tool_timeout_sec`, defaultToolTimeoutMs),
    enabledTools: value.enabled_tools === undefined ? null : new Set(stringArray(value.enabled_tools, `${id}.enabled_tools`)),
    disabledTools: new Set(value.disabled_tools === undefined ? [] : stringArray(value.disabled_tools, `${id}.disabled_tools`)),
  };
  const command = optionalString(value.command, `${id}.command`);
  const url = optionalString(value.url, `${id}.url`);
  if (Boolean(command) === Boolean(url)) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `普通 MCP 服务 ${id} 必须且只能配置 command 或 url。`);
  if (command) {
    return {
      ...base,
      transport: 'stdio',
      command,
      args: value.args === undefined ? [] : stringArray(value.args, `${id}.args`),
      ...(value.cwd === undefined ? {} : { cwd: requiredString(value.cwd, `${id}.cwd`) }),
      env: stringRecord(value.env, `${id}.env`),
      envVars: value.env_vars === undefined ? [] : environmentNames(value.env_vars, `${id}.env_vars`),
    };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url!);
  } catch {
    throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `普通 MCP 服务 ${id} 的 url 无效。`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `普通 MCP 服务 ${id} 的 url 只支持 http 或 https。`);
  return {
    ...base,
    transport: 'http',
    url: parsedUrl.toString(),
    httpHeaders: stringRecord(value.http_headers, `${id}.http_headers`),
    envHttpHeaders: environmentRecord(value.env_http_headers, `${id}.env_http_headers`),
    ...(value.http_headers_helper === undefined ? {} : { unsupportedReason: `普通 MCP 服务 ${id} 使用了 Pi 尚不支持的 http_headers_helper。` }),
    ...(value.bearer_token_env_var === undefined ? {} : { bearerTokenEnvVar: environmentName(value.bearer_token_env_var, `${id}.bearer_token_env_var`) }),
  };
}

function createStdioTransport(server: Extract<ConfiguredMcpServer, { transport: 'stdio' }>): StdioClientTransport {
  const inherited = Object.fromEntries(server.envVars.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]!]])));
  return new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...getDefaultEnvironment(), ...inherited, ...server.env },
    ...(server.cwd ? { cwd: server.cwd } : {}),
    stderr: 'pipe',
    maxBufferSize: 10 * 1024 * 1024,
  });
}

function configuredHttpHeaders(server: Extract<ConfiguredMcpServer, { transport: 'http' }>): Record<string, string> {
  const headers = { ...server.httpHeaders };
  for (const [header, environmentVariable] of Object.entries(server.envHttpHeaders)) {
    const value = process.env[environmentVariable];
    if (value === undefined) throw configuredMcpError('ZEUS_CONFIGURED_MCP_ENV_MISSING', `普通 MCP 服务 ${server.id} 缺少 Header 环境变量 ${environmentVariable}。`);
    headers[header] = value;
  }
  if (server.bearerTokenEnvVar) {
    const token = process.env[server.bearerTokenEnvVar];
    if (!token) throw configuredMcpError('ZEUS_CONFIGURED_MCP_ENV_MISSING', `普通 MCP 服务 ${server.id} 缺少 Bearer Token 环境变量 ${server.bearerTokenEnvVar}。`);
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function toolEnabled(server: ConfiguredMcpServer, toolName: string): boolean {
  return !server.disabledTools.has(toolName) && (server.enabledTools === null || server.enabledTools.has(toolName));
}

function configuredToolName(serverId: string, toolName: string): string {
  if (!toolName.trim() || toolName.includes('\0')) throw configuredMcpError('ZEUS_CONFIGURED_MCP_TOOL_INVALID', `普通 MCP 服务 ${serverId} 返回了无效工具名。`);
  const name = `mcp__${serverId}__${toolName}`;
  if (Array.from(name).length > 160) throw configuredMcpError('ZEUS_CONFIGURED_MCP_TOOL_INVALID', `普通 MCP 工具身份超过 Pi 的 160 字符上限：${serverId}/${toolName}`);
  return name;
}

function toolDefinitionSha256(tool: Tool): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema ?? null,
        annotations: tool.annotations ?? null,
        execution: tool.execution ?? null,
        _meta: tool._meta ?? null,
      }),
    )
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function toolResultText(result: { content: unknown[]; structuredContent?: unknown }): string {
  const text = result.content
    .filter((entry) => !isRecord(entry) || entry.type !== 'image')
    .map((entry) => (isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string' ? entry.text : JSON.stringify(entry)))
    .filter(Boolean)
    .join('\n');
  const output = text || (result.structuredContent === undefined ? '' : JSON.stringify(result.structuredContent));
  if (Buffer.byteLength(output, 'utf8') > maximumToolResultBytes) throw configuredMcpError('ZEUS_CONFIGURED_MCP_RESULT_TOO_LARGE', '普通 MCP 工具结果超过 8 MiB。');
  return output;
}

function toolResultImages(content: unknown[]): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  let bytes = 0;
  for (const entry of content) {
    if (!isRecord(entry) || entry.type !== 'image') continue;
    if (typeof entry.data !== 'string' || typeof entry.mimeType !== 'string' || !/^image\/[a-z0-9.+-]+$/iu.test(entry.mimeType) || !/^[a-z0-9+/]+={0,2}$/iu.test(entry.data) || entry.data.length % 4 !== 0) {
      throw configuredMcpError('ZEUS_CONFIGURED_MCP_IMAGE_INVALID', '普通 MCP 返回的图片格式无效。');
    }
    bytes += Buffer.byteLength(entry.data, 'base64');
    if (bytes > maximumToolResultBytes) throw configuredMcpError('ZEUS_CONFIGURED_MCP_RESULT_TOO_LARGE', '普通 MCP 图片结果超过 8 MiB。');
    images.push({ data: entry.data, mimeType: entry.mimeType });
  }
  return images;
}

function toolVisibility(tool: Tool): 'model' | 'app' | 'both' {
  const metadata = isRecord(tool._meta) ? tool._meta : {};
  const ui = isRecord(metadata.ui) ? metadata.ui : {};
  const visibility = ui.visibility;
  if (visibility === 'app' || visibility === 'model') return visibility;
  if (Array.isArray(visibility)) {
    const model = visibility.includes('model');
    const app = visibility.includes('app');
    return model && app ? 'both' : app ? 'app' : 'model';
  }
  return 'both';
}

function normalizeInputSchema(value: unknown): Record<string, unknown> {
  return isRecord(value) ? structuredClone(value) : { type: 'object', properties: {}, additionalProperties: true };
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 必须是布尔值。`);
  return value;
}

function optionalSeconds(value: unknown, label: string, fallbackMs: number): number {
  if (value === undefined) return fallbackMs;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 3600) {
    throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 必须是 0 到 3600 之间的秒数。`);
  }
  return Math.max(1, Math.round(value * 1_000));
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return requiredString(value, label);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 必须是非空字符串。`);
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.includes('\0'))) {
    throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 必须是非空字符串数组。`);
  }
  return value.map((entry) => entry.trim());
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 必须是字符串表。`);
  const entries = Object.entries(value);
  if (entries.some(([key, entry]) => !key.trim() || key.includes('\0') || typeof entry !== 'string' || entry.includes('\0'))) {
    throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 必须只包含有效字符串。`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function environmentNames(value: unknown, label: string): string[] {
  return stringArray(value, label).map((entry) => environmentName(entry, label));
}

function environmentRecord(value: unknown, label: string): Record<string, string> {
  const result = stringRecord(value, label);
  return Object.fromEntries(Object.entries(result).map(([key, name]) => [key, environmentName(name, label)]));
}

function environmentName(value: unknown, label: string): string {
  const name = requiredString(value, label);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw configuredMcpError('ZEUS_CONFIGURED_MCP_CONFIG_INVALID', `${label} 包含无效环境变量名。`);
  return name;
}

function boundedText(value: string, maximumCharacters: number): string {
  return Array.from(value).slice(0, maximumCharacters).join('');
}

function connectionKey(conversationId: string, serverId: string): string {
  return `${conversationId}\u0000${serverId}`;
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误';
  return raw
    .replaceAll(/(authorization|api[_-]?key|token|secret|password)(\s*[:=]\s*)[^\s,;]+/giu, '$1$2[已隐藏]')
    .replaceAll(/https?:\/\/[^\s]+/giu, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return '[URL 已隐藏]';
      }
    })
    .slice(0, 600);
}

function configuredMcpError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}
