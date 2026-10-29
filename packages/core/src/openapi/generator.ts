import { z } from 'zod';
import type { StandardSchemaV1 } from '../common/standard-schema.js';
import type { RouteCachePolicy } from '../pipeline/cache.js';
import type { DocumentedErrorStatus, HttpMethod, RouteOptions } from '../routing/types.js';
import { toOpenApiPath } from '../routing/versioning.js';

export interface RegisteredRouteMeta {
  readonly method: HttpMethod;
  readonly fullPath: string;
  readonly controllerName: string;
  readonly handlerName: string;
  readonly tags: readonly string[];
  readonly requiresAuth: boolean;
  readonly cachePolicy?: RouteCachePolicy | undefined;
  readonly etagEnabled?: boolean | undefined;
  readonly options: RouteOptions<
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined
  >;
}

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}

export interface OpenApiOptions {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly ui?: boolean;
  readonly title?: string;
  readonly version?: string;
  readonly description?: string;
  readonly servers?: readonly OpenApiServer[];
  readonly includeSystemRoutes?: boolean;
  readonly metricsPath?: string;
}

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly OpenApiServer[];
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly securitySchemes: Record<string, unknown>;
    readonly schemas: Record<string, unknown>;
  };
}

type JsonSchemaObject = Record<string, unknown>;

const ERROR_STATUS_DESCRIPTIONS: Record<DocumentedErrorStatus, string> = {
  400: 'Bad Request / Validation Failed (RFC 7807 Problem Details)',
  401: 'Unauthorized (RFC 7807 Problem Details)',
  403: 'Forbidden (RFC 7807 Problem Details)',
  404: 'Resource Not Found (RFC 7807 Problem Details)',
  408: 'Request Timeout (RFC 7807 Problem Details)',
  409: 'Resource Conflict (RFC 7807 Problem Details)',
  413: 'Payload Too Large (RFC 7807 Problem Details)',
  422: 'Unprocessable Entity (RFC 7807 Problem Details)',
  429: 'Too Many Requests / Rate Limit Exceeded (RFC 7807 Problem Details)',
  503: 'Service Unavailable (RFC 7807 Problem Details)',
};

function isZodV4Schema(schema: StandardSchemaV1): schema is z.ZodType {
  return typeof schema === 'object' && schema !== null && '_zod' in schema;
}

function rewriteDefsRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(rewriteDefsRefs);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '$schema' || k === '$defs') continue;
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/')) {
        out[k] = `#/components/schemas/${v.slice('#/$defs/'.length)}`;
      } else {
        out[k] = rewriteDefsRefs(v);
      }
    }
    return out;
  }
  return value;
}

function ingestRawJsonSchema(
  raw: JsonSchemaObject,
  componentSchemas: Record<string, JsonSchemaObject>,
): JsonSchemaObject {
  const rawDefs = raw['$defs'];
  if (typeof rawDefs === 'object' && rawDefs !== null) {
    for (const [defName, defSchema] of Object.entries(rawDefs as Record<string, unknown>)) {
      if (typeof defSchema === 'object' && defSchema !== null && !(defName in componentSchemas)) {
        const cleanedDef = rewriteDefsRefs(defSchema) as JsonSchemaObject;
        delete cleanedDef['id'];
        componentSchemas[defName] = cleanedDef;
      }
    }
  }
  return rewriteDefsRefs(raw) as JsonSchemaObject;
}

function toCleanJsonSchema(
  schema: StandardSchemaV1,
  mode: 'input' | 'output',
  componentSchemas: Record<string, JsonSchemaObject>,
): JsonSchemaObject {
  if (isZodV4Schema(schema)) {
    const raw = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: mode,
      unrepresentable: 'any',
    }) as JsonSchemaObject;
    return ingestRawJsonSchema(raw, componentSchemas);
  }

  const converter = schema['~standard'].jsonSchema;
  if (converter) {
    try {
      const raw =
        mode === 'input'
          ? converter.input({ target: 'draft-2020-12' })
          : converter.output({ target: 'draft-2020-12' });
      return ingestRawJsonSchema(raw, componentSchemas);
    } catch {
      return {};
    }
  }

  return {};
}

function resolveComponentRef(
  jsonSchema: JsonSchemaObject | undefined,
  componentSchemas: Record<string, JsonSchemaObject>,
): JsonSchemaObject | undefined {
  if (!jsonSchema) return undefined;
  const ref = jsonSchema['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    const name = ref.slice('#/components/schemas/'.length);
    return componentSchemas[name] ?? jsonSchema;
  }
  return jsonSchema;
}

function extractExpressParamNames(fullPath: string): string[] {
  const names: string[] = [];
  const regex = /:([A-Za-z0-9_]+)\??/g;
  let match = regex.exec(fullPath);
  while (match !== null) {
    if (match[1]) names.push(match[1]);
    match = regex.exec(fullPath);
  }
  return names;
}

function extractObjectProperties(
  rawJsonSchema: JsonSchemaObject | undefined,
  componentSchemas: Record<string, JsonSchemaObject>,
): {
  readonly properties: Record<string, JsonSchemaObject>;
  readonly required: Set<string>;
} {
  const jsonSchema = resolveComponentRef(rawJsonSchema, componentSchemas);
  if (
    !jsonSchema ||
    typeof jsonSchema['properties'] !== 'object' ||
    jsonSchema['properties'] === null
  ) {
    return { properties: {}, required: new Set() };
  }
  const props = jsonSchema['properties'] as Record<string, JsonSchemaObject>;
  const reqArr = Array.isArray(jsonSchema['required'])
    ? (jsonSchema['required'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return {
    properties: props,
    required: new Set(reqArr),
  };
}

/**
 * Generates an OpenAPI 3.1.0 specification directly from Better Back's single-source-of-truth
 * Zod v4 / Standard Schema v1 route contracts — hoisting `.meta({ id })` schemas into `#/components/schemas`
 * and making documentation drift structurally impossible.
 */
export function generateOpenApiDocument(
  routes: readonly RegisteredRouteMeta[],
  options: OpenApiOptions = {},
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagSet = new Set<string>();
  const componentSchemas: Record<string, JsonSchemaObject> = {
    ValidationIssue: {
      type: 'object',
      required: ['location', 'path', 'code', 'message'],
      properties: {
        location: {
          type: 'string',
          enum: ['body', 'query', 'params', 'headers', 'response'],
        },
        path: { type: 'string' },
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
    ProblemDetails: {
      type: 'object',
      required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'requestId'],
      properties: {
        type: { type: 'string', format: 'uri' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string' },
        code: { type: 'string' },
        requestId: { type: 'string' },
        errors: {
          type: 'array',
          items: { $ref: '#/components/schemas/ValidationIssue' },
        },
        retryAfterSeconds: { type: 'integer' },
      },
    },
  };
  let usesAuth = false;

  for (const r of routes) {
    const openApiPath = toOpenApiPath(r.fullPath);
    const pathItem = paths[openApiPath] ?? {};
    paths[openApiPath] = pathItem;

    const opTags = r.options.tags ?? r.tags;
    for (const t of opTags) {
      tagSet.add(t);
    }

    const parameters: Record<string, unknown>[] = [];
    const pathParamNames = extractExpressParamNames(r.fullPath);
    const paramsJson = r.options.params
      ? toCleanJsonSchema(r.options.params, 'input', componentSchemas)
      : undefined;
    const parsedParams = extractObjectProperties(paramsJson, componentSchemas);

    const seenPathParams = new Set<string>();
    for (const paramName of pathParamNames) {
      seenPathParams.add(paramName);
      const propSchema = parsedParams.properties[paramName] ?? { type: 'string' };
      const description =
        typeof propSchema['description'] === 'string' ? propSchema['description'] : undefined;
      parameters.push({
        name: paramName,
        in: 'path',
        required: true,
        ...(description ? { description } : {}),
        schema: propSchema,
      });
    }

    for (const [name, propSchema] of Object.entries(parsedParams.properties)) {
      if (!seenPathParams.has(name)) {
        parameters.push({
          name,
          in: 'path',
          required: true,
          schema: propSchema,
        });
      }
    }

    if (r.options.query) {
      const queryJson = toCleanJsonSchema(r.options.query, 'input', componentSchemas);
      const parsedQuery = extractObjectProperties(queryJson, componentSchemas);
      for (const [name, propSchema] of Object.entries(parsedQuery.properties)) {
        const description =
          typeof propSchema['description'] === 'string' ? propSchema['description'] : undefined;
        parameters.push({
          name: name,
          in: 'query',
          required: parsedQuery.required.has(name),
          ...(description ? { description } : {}),
          schema: propSchema,
        });
      }
    }

    if (r.options.headers) {
      const headersJson = toCleanJsonSchema(r.options.headers, 'input', componentSchemas);
      const parsedHeaders = extractObjectProperties(headersJson, componentSchemas);
      for (const [name, propSchema] of Object.entries(parsedHeaders.properties)) {
        parameters.push({
          name,
          in: 'header',
          required: parsedHeaders.required.has(name),
          schema: propSchema,
        });
      }
    }

    const defaultStatus = r.options.status ?? (r.method === 'post' ? 201 : 200);
    const statusKey = String(defaultStatus);

    const responseHeaders: Record<string, unknown> = {};
    if (r.cachePolicy && (r.method === 'get' || r.method === 'head')) {
      responseHeaders['X-Cache'] = {
        description: 'Cache lookup state (HIT, MISS, or STALE)',
        schema: { type: 'string', enum: ['HIT', 'MISS', 'STALE'] },
      };
    }
    if (r.etagEnabled && (r.method === 'get' || r.method === 'head')) {
      responseHeaders['ETag'] = {
        description: 'RFC 9110 weak entity tag',
        schema: { type: 'string' },
      };
    }
    const hasResHeaders = Object.keys(responseHeaders).length > 0;

    const responses: Record<string, unknown> = {};
    if (r.options.sse) {
      responses['200'] = {
        description: 'Server-Sent Events (SSE) stream',
        content: {
          'text/event-stream': {
            schema: toCleanJsonSchema(r.options.sse, 'output', componentSchemas),
          },
        },
      };
    } else if (defaultStatus === 204) {
      responses['204'] = { description: 'No Content' };
    } else if (r.method === 'head' && !r.options.response) {
      responses[statusKey] = {
        description: 'Successful HEAD response (headers only)',
        ...(hasResHeaders ? { headers: responseHeaders } : {}),
      };
    } else if (r.options.response) {
      responses[statusKey] = {
        description: 'Successful JSON response',
        ...(hasResHeaders ? { headers: responseHeaders } : {}),
        content: {
          'application/json': {
            schema: toCleanJsonSchema(r.options.response, 'output', componentSchemas),
          },
        },
      };
    } else {
      responses[statusKey] = {
        description: 'Successful JSON response',
        ...(hasResHeaders ? { headers: responseHeaders } : {}),
        content: {
          'application/json': {
            schema: {},
          },
        },
      };
    }

    if (r.etagEnabled && (r.method === 'get' || r.method === 'head') && defaultStatus === 200) {
      responses['304'] = {
        description: 'Not Modified (If-None-Match matched current ETag)',
      };
    }

    if (r.options.body || r.options.query || r.options.params || r.options.headers) {
      responses['400'] = {
        description: 'Validation Failed (RFC 7807 Problem Details)',
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/ProblemDetails' },
          },
        },
      };
    }

    if (r.requiresAuth) {
      usesAuth = true;
      responses['401'] = {
        description: 'Unauthorized (RFC 7807 Problem Details)',
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/ProblemDetails' },
          },
        },
      };
    }

    if (r.options.rateLimit) {
      responses['429'] = {
        description: 'Rate Limit Exceeded (RFC 7807 Problem Details)',
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/ProblemDetails' },
          },
        },
      };
    }

    if (r.options.errors) {
      for (const errCode of r.options.errors) {
        const key = String(errCode);
        if (!(key in responses)) {
          responses[key] = {
            description: ERROR_STATUS_DESCRIPTIONS[errCode],
            content: {
              'application/problem+json': {
                schema: { $ref: '#/components/schemas/ProblemDetails' },
              },
            },
          };
        }
      }
    }

    responses['500'] = {
      description: 'Internal Server Error (RFC 7807 Problem Details)',
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDetails' },
        },
      },
    };

    const operation: Record<string, unknown> = {
      operationId: `${r.controllerName}_${r.handlerName}`,
      tags: opTags,
      ...(r.options.summary ? { summary: r.options.summary } : {}),
      ...(r.options.description ? { description: r.options.description } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(r.options.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: toCleanJsonSchema(r.options.body, 'input', componentSchemas),
                },
              },
            },
          }
        : {}),
      ...(r.requiresAuth ? { security: [{ bearerAuth: [] }] } : {}),
      responses,
    };

    pathItem[r.method] = operation;
  }

  if (options.includeSystemRoutes ?? true) {
    tagSet.add('System');
    if (!paths['/health']) {
      paths['/health'] = {
        get: {
          operationId: 'System_health',
          tags: ['System'],
          summary: 'Liveness probe',
          responses: {
            '200': {
              description: 'Process event loop is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'uptimeSeconds'],
                    properties: {
                      status: { type: 'string', enum: ['ok'] },
                      uptimeSeconds: { type: 'integer', minimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }
    if (!paths['/ready']) {
      paths['/ready'] = {
        get: {
          operationId: 'System_ready',
          tags: ['System'],
          summary: 'Readiness probe across registered HealthChecks',
          responses: {
            '200': {
              description: 'Instance is ready to accept traffic',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'checks'],
                    properties: {
                      status: { type: 'string', enum: ['ready'] },
                      checks: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Unhealthy dependency or graceful shutdown draining',
              content: {
                'application/problem+json': {
                  schema: { $ref: '#/components/schemas/ProblemDetails' },
                },
              },
            },
          },
        },
      };
    }
    if (options.metricsPath && !paths[options.metricsPath]) {
      paths[options.metricsPath] = {
        get: {
          operationId: 'System_metrics',
          tags: ['System'],
          summary: 'OpenMetrics / Prometheus & JSON telemetry endpoint',
          responses: {
            '200': {
              description: 'Current process & HTTP RED metrics',
              content: {
                'text/plain': { schema: { type: 'string' } },
                'application/json': { schema: { type: 'object', additionalProperties: true } },
              },
            },
          },
        },
      };
    }
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: options.title ?? 'Better Back API',
      version: options.version ?? '1.1.0',
      ...(options.description ? { description: options.description } : {}),
    },
    ...(options.servers && options.servers.length > 0 ? { servers: options.servers } : {}),
    tags: [...tagSet].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: usesAuth
        ? {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          }
        : {},
      schemas: componentSchemas,
    },
  };
}
