import type { OpenApiDocument } from '../openapi/generator.js';

export interface SdkGeneratorOptions {
  /** Generated factory function name (default: `"createApiClient"`). */
  readonly clientName?: string;
  /** Exclude `/health`, `/ready`, `/metrics` system endpoints if false (default: `true`). */
  readonly includeSystemRoutes?: boolean;
}

type JsonSchemaNode = Record<string, unknown>;

function toSafeTypeIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_$]/g, '_');
  const prefixed = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return prefixed || 'UnnamedSchema';
}

function toCamelIdentifier(raw: string): string {
  const cleaned = raw
    .replace(/Controller$/i, '')
    .replace(/[^A-Za-z0-9]+(.)/g, (_m, ch: string) => ch.toUpperCase())
    .replace(/[^A-Za-z0-9_$]/g, '');
  if (!cleaned) return 'defaultGroup';
  const camel = cleaned[0]!.toLowerCase() + cleaned.slice(1);
  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
}

function formatPropertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderJsonSchemaToTs(schema: unknown, indent = ''): string {
  if (!schema || typeof schema !== 'object') {
    return 'unknown';
  }
  const node = schema as JsonSchemaNode;

  if (typeof node['$ref'] === 'string') {
    const ref = node['$ref'];
    if (ref.startsWith('#/components/schemas/')) {
      return toSafeTypeIdentifier(ref.slice('#/components/schemas/'.length));
    }
    return 'unknown';
  }

  if ('const' in node && node['const'] !== undefined) {
    return JSON.stringify(node['const']);
  }

  if (Array.isArray(node['enum']) && node['enum'].length > 0) {
    return (node['enum'] as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
  }

  if (Array.isArray(node['anyOf']) && node['anyOf'].length > 0) {
    const parts = (node['anyOf'] as unknown[]).map((sub) => renderJsonSchemaToTs(sub, indent));
    return [...new Set(parts)].join(' | ');
  }

  if (Array.isArray(node['oneOf']) && node['oneOf'].length > 0) {
    const parts = (node['oneOf'] as unknown[]).map((sub) => renderJsonSchemaToTs(sub, indent));
    return [...new Set(parts)].join(' | ');
  }

  if (Array.isArray(node['allOf']) && node['allOf'].length > 0) {
    const parts = (node['allOf'] as unknown[]).map((sub) => renderJsonSchemaToTs(sub, indent));
    return parts.map((p) => (p.includes(' | ') ? `(${p})` : p)).join(' & ');
  }

  const rawType = node['type'];
  if (Array.isArray(rawType)) {
    const subTypes = (rawType as unknown[])
      .filter((t): t is string => typeof t === 'string')
      .map((single) => renderJsonSchemaToTs({ ...node, type: single }, indent));
    return [...new Set(subTypes)].join(' | ') || 'unknown';
  }

  if (rawType === 'null') return 'null';
  if (rawType === 'boolean') return 'boolean';
  if (rawType === 'integer' || rawType === 'number') return 'number';
  if (rawType === 'string') return 'string';

  if (rawType === 'array') {
    const itemTs = node['items'] ? renderJsonSchemaToTs(node['items'], indent) : 'unknown';
    const wrapped = itemTs.includes(' | ') || itemTs.includes(' & ') ? `(${itemTs})` : itemTs;
    return `readonly ${wrapped}[]`;
  }

  if (
    rawType === 'object' ||
    typeof node['properties'] === 'object' ||
    node['additionalProperties'] !== undefined
  ) {
    const props =
      typeof node['properties'] === 'object' && node['properties'] !== null
        ? (node['properties'] as Record<string, unknown>)
        : undefined;
    const reqSet = new Set<string>(
      Array.isArray(node['required'])
        ? (node['required'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
    );

    if (!props || Object.keys(props).length === 0) {
      if (node['additionalProperties'] && typeof node['additionalProperties'] === 'object') {
        const valTs = renderJsonSchemaToTs(node['additionalProperties'], indent);
        return `Readonly<Record<string, ${valTs}>>`;
      }
      if (node['additionalProperties'] === true) {
        return 'Readonly<Record<string, unknown>>';
      }
      return 'Readonly<Record<string, unknown>>';
    }

    const nextIndent = `${indent}  `;
    const lines: string[] = ['{'];
    for (const [propName, propSchema] of Object.entries(props)) {
      const optional = reqSet.has(propName) ? '' : '?';
      const propTs = renderJsonSchemaToTs(propSchema, nextIndent);
      lines.push(`${nextIndent}readonly ${formatPropertyKey(propName)}${optional}: ${propTs};`);
    }
    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  return 'unknown';
}

interface ParsedParam {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required: boolean;
  readonly tsType: string;
}

interface ParsedOperation {
  readonly method: string;
  readonly openApiPath: string;
  readonly operationId: string;
  readonly groupName: string;
  readonly shortMethodName: string;
  readonly summary: string | undefined;
  readonly pathParams: readonly ParsedParam[];
  readonly queryParams: readonly ParsedParam[];
  readonly headerParams: readonly ParsedParam[];
  readonly bodyType: string | undefined;
  readonly responseType: string;
  readonly isVoidResponse: boolean;
  readonly isSseResponse: boolean;
}

function deriveShortMethodName(operationId: string, fallbackMethod: string): string {
  const idx = operationId.indexOf('_');
  const raw = idx >= 0 ? operationId.slice(idx + 1) : `${fallbackMethod}_${operationId}`;
  return toCamelIdentifier(raw);
}

function renderParamGroupType(params: readonly ParsedParam[], indent: string): string {
  const lines: string[] = ['{'];
  for (const p of params) {
    const opt = p.required ? '' : '?';
    lines.push(`${indent}  readonly ${formatPropertyKey(p.name)}${opt}: ${p.tsType};`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

/**
 * Generates a standalone, zero-dependency, strict-TypeScript (`"strict": true`, zero `any`)
 * `fetch` client SDK directly from an `OpenApiDocument`.
 */
export function generateTypeScriptSdk(
  doc: OpenApiDocument,
  options: SdkGeneratorOptions = {},
): string {
  const clientName = options.clientName ?? 'createApiClient';
  const includeSystem = options.includeSystemRoutes ?? true;

  const lines: string[] = [
    '/* eslint-disable */',
    `// Auto-generated by Better Back CLI ("bb sdk") from ${doc.info.title} v${doc.info.version} (OpenAPI ${doc.openapi}).`,
    '// Do not edit manually — regenerate with "npx bb sdk" whenever route schemas change.',
    '',
  ];

  // 1. Emit component schemas
  const componentSchemas = doc.components?.schemas ?? {};
  for (const [rawName, rawSchema] of Object.entries(componentSchemas)) {
    const typeName = toSafeTypeIdentifier(rawName);
    const tsBody = renderJsonSchemaToTs(rawSchema, '');
    lines.push(`export type ${typeName} = ${tsBody};`);
    lines.push('');
  }

  if (!('ProblemDetails' in componentSchemas)) {
    lines.push('export interface ProblemDetails {');
    lines.push('  readonly type: string;');
    lines.push('  readonly title: string;');
    lines.push('  readonly status: number;');
    lines.push('  readonly detail: string;');
    lines.push('  readonly instance: string;');
    lines.push('  readonly code: string;');
    lines.push('  readonly requestId: string;');
    lines.push('}');
    lines.push('');
  }

  // 2. Parse operations
  const operations: ParsedOperation[] = [];
  const usedShortNamesByGroup = new Map<string, Set<string>>();

  for (const [openApiPath, rawMethods] of Object.entries(doc.paths)) {
    for (const [httpMethod, rawOp] of Object.entries(rawMethods)) {
      if (typeof rawOp !== 'object' || rawOp === null) continue;
      const op = rawOp as Record<string, unknown>;
      const tags = Array.isArray(op['tags'])
        ? (op['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];
      const isSystemPath =
        openApiPath === '/health' || openApiPath === '/ready' || openApiPath === '/metrics';
      if (!includeSystem && (tags.includes('System') || isSystemPath)) {
        continue;
      }

      const rawOpId =
        typeof op['operationId'] === 'string' && op['operationId'].length > 0
          ? op['operationId']
          : `${httpMethod}_${openApiPath}`;
      const operationId = toSafeTypeIdentifier(rawOpId);
      const groupName = toCamelIdentifier(tags[0] ?? 'api');

      const seenInGroup = usedShortNamesByGroup.get(groupName) ?? new Set<string>();
      usedShortNamesByGroup.set(groupName, seenInGroup);
      let shortMethodName = deriveShortMethodName(rawOpId, httpMethod);
      if (seenInGroup.has(shortMethodName)) {
        shortMethodName = toCamelIdentifier(`${httpMethod}_${shortMethodName}`);
      }
      seenInGroup.add(shortMethodName);

      const rawParams = Array.isArray(op['parameters'])
        ? (op['parameters'] as Record<string, unknown>[])
        : [];
      const pathParams: ParsedParam[] = [];
      const queryParams: ParsedParam[] = [];
      const headerParams: ParsedParam[] = [];

      for (const param of rawParams) {
        const name = typeof param['name'] === 'string' ? param['name'] : '';
        const loc = param['in'];
        if (!name || (loc !== 'path' && loc !== 'query' && loc !== 'header')) continue;
        const required = loc === 'path' ? true : Boolean(param['required']);
        const tsType = renderJsonSchemaToTs(param['schema'], '    ');
        const entry: ParsedParam = { name, in: loc, required, tsType };
        if (loc === 'path') pathParams.push(entry);
        else if (loc === 'query') queryParams.push(entry);
        else headerParams.push(entry);
      }

      let bodyType: string | undefined;
      const reqBody = op['requestBody'] as Record<string, unknown> | undefined;
      const reqContent = reqBody?.['content'] as Record<string, unknown> | undefined;
      const jsonBodyMedia = reqContent?.['application/json'] as Record<string, unknown> | undefined;
      if (jsonBodyMedia && 'schema' in jsonBodyMedia) {
        bodyType = renderJsonSchemaToTs(jsonBodyMedia['schema'], '  ');
      }

      const responses = (op['responses'] as Record<string, unknown> | undefined) ?? {};
      let responseType = 'unknown';
      let isVoidResponse = false;
      let isSseResponse = false;

      if ('204' in responses && !('200' in responses) && !('201' in responses)) {
        responseType = 'void';
        isVoidResponse = true;
      } else {
        const successEntry =
          (responses['200'] as Record<string, unknown> | undefined) ??
          (responses['201'] as Record<string, unknown> | undefined) ??
          (responses['202'] as Record<string, unknown> | undefined);
        const content = successEntry?.['content'] as Record<string, unknown> | undefined;
        const jsonMedia = content?.['application/json'] as Record<string, unknown> | undefined;
        const sseMedia = content?.['text/event-stream'] as Record<string, unknown> | undefined;
        const textMedia = content?.['text/plain'] as Record<string, unknown> | undefined;

        if (sseMedia && 'schema' in sseMedia) {
          responseType = renderJsonSchemaToTs(sseMedia['schema'], '');
          isSseResponse = true;
        } else if (jsonMedia && 'schema' in jsonMedia) {
          responseType = renderJsonSchemaToTs(jsonMedia['schema'], '');
        } else if (textMedia) {
          responseType = 'string';
        } else if (!content) {
          responseType = 'void';
          isVoidResponse = true;
        }
      }

      operations.push({
        method: httpMethod.toUpperCase(),
        openApiPath,
        operationId,
        groupName,
        shortMethodName,
        summary: typeof op['summary'] === 'string' ? op['summary'] : undefined,
        pathParams,
        queryParams,
        headerParams,
        bodyType,
        responseType,
        isVoidResponse,
        isSseResponse,
      });
    }
  }

  // 3. Emit per-operation Input types
  for (const op of operations) {
    const inputName = `${op.operationId}Input`;
    const fields: string[] = [];
    if (op.pathParams.length > 0) {
      fields.push(`  readonly params: ${renderParamGroupType(op.pathParams, '  ')};`);
    }
    if (op.queryParams.length > 0) {
      const qReq = op.queryParams.some((p) => p.required) ? '' : '?';
      fields.push(`  readonly query${qReq}: ${renderParamGroupType(op.queryParams, '  ')};`);
    }
    if (op.bodyType !== undefined) {
      fields.push(`  readonly body: ${op.bodyType};`);
    }
    const hdrReq = op.headerParams.some((p) => p.required) ? '' : '?';
    if (op.headerParams.length > 0) {
      fields.push(
        `  readonly headers${hdrReq}: ${renderParamGroupType(op.headerParams, '  ')} & Readonly<Record<string, string | undefined>>;`,
      );
    } else {
      fields.push('  readonly headers?: Readonly<Record<string, string>>;');
    }
    fields.push('  readonly signal?: AbortSignal;');

    lines.push(`export interface ${inputName} {`);
    lines.push(...fields);
    lines.push('}');
    lines.push('');
  }

  // 4. Emit error & runtime transport helpers
  lines.push(`export class BetterBackClientError extends Error {
  public readonly status: number;
  public readonly problem: ProblemDetails | undefined;
  public readonly requestId: string | undefined;

  public constructor(message: string, status: number, problem?: ProblemDetails, requestId?: string) {
    super(message);
    this.name = 'BetterBackClientError';
    this.status = status;
    this.problem = problem;
    this.requestId = requestId ?? problem?.requestId;
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly token?: string | (() => string | undefined | Promise<string | undefined>);
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

interface InternalRequestArgs {
  readonly method: string;
  readonly pathTemplate: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
  readonly parseAs: 'json' | 'void' | 'text';
}

function buildUrl(
  baseUrl: string,
  pathTemplate: string,
  params?: Readonly<Record<string, unknown>>,
  query?: Readonly<Record<string, unknown>>,
): string {
  const normalizedBase = baseUrl.replace(/\\/+$/, '');
  let resolvedPath = pathTemplate;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      resolvedPath = resolvedPath.replace(\`{\${k}}\`, encodeURIComponent(String(v)));
    }
  }
  const search = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) search.append(k, String(item));
      } else {
        search.set(k, String(v));
      }
    }
  }
  const qs = search.toString();
  return \`\${normalizedBase}\${resolvedPath}\${qs ? \`?\${qs}\` : ''}\`;
}
`);

  const hasSseOperations = operations.some((op) => op.isSseResponse);
  if (hasSseOperations) {
    lines.push(`export interface SseClientMessage<T> {
  readonly event?: string;
  readonly id?: string;
  readonly data: T;
}
`);
  }

  // 5. Group operations by tag namespace
  const byGroup = new Map<string, ParsedOperation[]>();
  for (const op of operations) {
    const arr = byGroup.get(op.groupName) ?? [];
    arr.push(op);
    byGroup.set(op.groupName, arr);
  }

  lines.push(`export function ${clientName}(options: ApiClientOptions) {`);
  lines.push('  const fetchImpl = options.fetch ?? globalThis.fetch;');
  lines.push(`
  async function send<T>(args: InternalRequestArgs): Promise<T> {
    const url = buildUrl(options.baseUrl, args.pathTemplate, args.params, args.query);
    const reqHeaders: Record<string, string> = {
      Accept: args.parseAs === 'text' ? 'text/plain' : 'application/json',
      ...(options.headers ?? {}),
    };
    if (args.headers) {
      for (const [k, v] of Object.entries(args.headers)) {
        if (v !== undefined) reqHeaders[k] = v;
      }
    }
    const resolvedToken =
      typeof options.token === 'function' ? await options.token() : options.token;
    if (resolvedToken && !('Authorization' in reqHeaders) && !('authorization' in reqHeaders)) {
      reqHeaders['Authorization'] = resolvedToken.startsWith('Bearer ')
        ? resolvedToken
        : \`Bearer \${resolvedToken}\`;
    }
    if (args.body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const res = await fetchImpl(url, {
      method: args.method,
      headers: reqHeaders,
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
      signal: args.signal,
    });

    const reqId = res.headers.get('x-request-id') ?? undefined;

    if (!res.ok) {
      let problem: ProblemDetails | undefined;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('json')) {
        try {
          problem = (await res.json()) as ProblemDetails;
        } catch {
          // Ignore malformed error body
        }
      }
      const message = problem?.detail ?? \`HTTP \${res.status} \${res.statusText}\`;
      throw new BetterBackClientError(message, res.status, problem, reqId);
    }

    if (args.parseAs === 'void' || res.status === 204) {
      return undefined as T;
    }
    if (args.parseAs === 'text') {
      return (await res.text()) as T;
    }
    return (await res.json()) as T;
  }
`);

  if (hasSseOperations) {
    lines.push(`  async function* streamSse<T>(
    args: Omit<InternalRequestArgs, 'parseAs'>,
  ): AsyncGenerator<SseClientMessage<T>, void, void> {
    const url = buildUrl(options.baseUrl, args.pathTemplate, args.params, args.query);
    const reqHeaders: Record<string, string> = {
      Accept: 'text/event-stream',
      ...(options.headers ?? {}),
    };
    if (args.headers) {
      for (const [k, v] of Object.entries(args.headers)) {
        if (v !== undefined) reqHeaders[k] = v;
      }
    }
    const resolvedToken =
      typeof options.token === 'function' ? await options.token() : options.token;
    if (resolvedToken && !('Authorization' in reqHeaders) && !('authorization' in reqHeaders)) {
      reqHeaders['Authorization'] = resolvedToken.startsWith('Bearer ')
        ? resolvedToken
        : \`Bearer \${resolvedToken}\`;
    }

    const res = await fetchImpl(url, {
      method: args.method,
      headers: reqHeaders,
      signal: args.signal,
    });

    const reqId = res.headers.get('x-request-id') ?? undefined;
    if (!res.ok || !res.body) {
      throw new BetterBackClientError(\`HTTP \${res.status} \${res.statusText}\`, res.status, undefined, reqId);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\\n\\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          let eventName: string | undefined;
          let eventId: string | undefined;
          const dataLines: string[] = [];
          for (const rawLine of block.split('\\n')) {
            if (rawLine.startsWith(':')) continue;
            if (rawLine.startsWith('event:')) eventName = rawLine.slice(6).trim();
            else if (rawLine.startsWith('id:')) eventId = rawLine.slice(3).trim();
            else if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trimStart());
          }
          if (dataLines.length > 0) {
            const rawPayload = dataLines.join('\\n');
            const parsed = JSON.parse(rawPayload) as T;
            yield {
              ...(eventName !== undefined ? { event: eventName } : {}),
              ...(eventId !== undefined ? { id: eventId } : {}),
              data: parsed,
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
`);
  }

  for (const op of operations) {
    const inputName = `${op.operationId}Input`;
    const requiresInput =
      op.pathParams.length > 0 ||
      op.bodyType !== undefined ||
      op.queryParams.some((p) => p.required) ||
      op.headerParams.some((p) => p.required);

    const paramSig = requiresInput ? `input: ${inputName}` : `input: ${inputName} = {}`;

    const sendProps: string[] = [
      `method: ${JSON.stringify(op.method)}`,
      `pathTemplate: ${JSON.stringify(op.openApiPath)}`,
    ];
    if (op.pathParams.length > 0) sendProps.push('params: input.params');
    if (op.queryParams.length > 0) sendProps.push('query: input.query');
    if (op.bodyType !== undefined) sendProps.push('body: input.body');
    sendProps.push('headers: input.headers');
    sendProps.push('signal: input.signal');

    if (op.summary) {
      lines.push(`  /** ${op.summary} */`);
    }

    if (op.isSseResponse) {
      lines.push(
        `  const ${op.operationId} = (${paramSig}): AsyncGenerator<SseClientMessage<${op.responseType}>, void, void> => streamSse<${op.responseType}>({ ${sendProps.join(', ')} });`,
      );
    } else {
      const parseMode = op.isVoidResponse ? 'void' : op.responseType === 'string' ? 'text' : 'json';
      sendProps.push(`parseAs: ${JSON.stringify(parseMode)}`);
      lines.push(
        `  const ${op.operationId} = (${paramSig}): Promise<${op.responseType}> => send<${op.responseType}>({ ${sendProps.join(', ')} });`,
      );
    }
  }

  lines.push('');
  lines.push('  return {');
  for (const [groupName, groupOps] of byGroup) {
    lines.push(`    ${formatPropertyKey(groupName)}: {`);
    for (const op of groupOps) {
      lines.push(`      ${formatPropertyKey(op.shortMethodName)}: ${op.operationId},`);
    }
    lines.push('    },');
  }
  for (const op of operations) {
    lines.push(`    ${op.operationId},`);
  }
  lines.push('  };');
  lines.push('}');
  lines.push('');
  lines.push(`export type ApiClient = ReturnType<typeof ${clientName}>;`);
  lines.push('');

  return lines.join('\n');
}
