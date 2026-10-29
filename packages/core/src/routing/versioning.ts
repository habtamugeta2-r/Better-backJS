export interface ResolvePathOptions {
  readonly apiPrefix?: string;
  readonly version?: string;
  readonly controllerPrefix: string;
  readonly routePath: string;
}

function cleanSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed || trimmed === '/') return '';
  return trimmed.replace(/^\/+|\/+$/g, '');
}

/**
 * Deterministically joins `apiPrefix`, optional controller `version` (`"1"` -> `"/v1"`),
 * `controllerPrefix`, and `routePath` into a canonical Express 5 path starting with `"/"`.
 */
export function resolveRoutePath(options: ResolvePathOptions): string {
  const parts: string[] = [];

  if (options.apiPrefix) {
    const p = cleanSegment(options.apiPrefix);
    if (p) parts.push(p);
  }

  if (options.version) {
    const rawVer = cleanSegment(options.version);
    if (rawVer) {
      parts.push(rawVer.startsWith('v') ? rawVer : `v${rawVer}`);
    }
  }

  const ctrl = cleanSegment(options.controllerPrefix);
  if (ctrl) parts.push(ctrl);

  const route = cleanSegment(options.routePath);
  if (route) parts.push(route);

  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

/**
 * Converts Express `:param` segments into OpenAPI `{param}` template syntax.
 */
export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');
}

/**
 * Produces a normalized route collision signature so duplicate routes — including
 * differently-named path parameters (`/users/:id` vs `/users/:userId`) — fail loudly at startup.
 */
export function normalizeRouteSignature(method: string, fullPath: string): string {
  const canonicalPath =
    fullPath === '/'
      ? '/'
      : fullPath.replace(/\/+$/g, '').replace(/:([A-Za-z0-9_]+)\??/g, ':param');
  return `${method.toUpperCase()} ${canonicalPath}`;
}
