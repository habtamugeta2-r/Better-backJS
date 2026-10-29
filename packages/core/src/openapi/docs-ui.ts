import { createHash } from 'node:crypto';
import type { Application } from 'express';
import type { OpenApiDocument, OpenApiOptions } from './generator.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sha256Base64(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('base64');
}

interface CompiledExplorerAssets {
  readonly html: string;
  readonly cspHeader: string;
}

function compileExplorerAssets(
  doc: OpenApiDocument,
  jsonUrl: string,
  frameOptions: 'DENY' | 'SAMEORIGIN' | false,
): CompiledExplorerAssets {
  const serializedSpec = JSON.stringify(doc).replace(/</g, '\\u003c');
  const title = escapeHtml(doc.info.title);
  const version = escapeHtml(doc.info.version);
  const description = doc.info.description ? escapeHtml(doc.info.description) : '';

  const styleContent = `
:root {
  --bg: #090d16;
  --panel: #111827;
  --panel-alt: #0d1321;
  --border: #1f2937;
  --border-hi: #334155;
  --text: #f8fafc;
  --muted: #94a3b8;
  --accent: #38bdf8;
  --accent-bg: rgba(56, 189, 248, 0.12);
  --ok: #22c55e;
  --warn: #f59e0b;
  --err: #ef4444;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
header {
  padding: 1.25rem 2rem;
  border-bottom: 1px solid var(--border);
  background: rgba(17, 24, 39, 0.85);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
.brand-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.brand-title { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.brand-desc { color: var(--muted); font-size: 0.86rem; margin-top: 0.2rem; }
.badge {
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid rgba(56, 189, 248, 0.3);
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
}
.raw-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.45rem 0.8rem;
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 0.5rem;
}
.raw-link:hover { background: var(--accent-bg); }
main { max-width: 1120px; margin: 0 auto; padding: 1.5rem 2rem 4rem; }
.controls-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  margin-bottom: 1rem;
}
@media (max-width: 760px) { .controls-grid { grid-template-columns: 1fr; } }
.control-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  padding: 0.65rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.control-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
input, textarea {
  background: var(--panel-alt);
  border: 1px solid var(--border-hi);
  color: var(--text);
  padding: 0.5rem 0.7rem;
  border-radius: 0.45rem;
  font-size: 0.86rem;
  font-family: inherit;
  width: 100%;
}
textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; min-height: 115px; resize: vertical; font-size: 0.8rem; }
input:focus, textarea:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
.tags-bar { display: flex; gap: 0.45rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.tag-pill {
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.tag-pill.active { background: var(--accent-bg); color: var(--accent); border-color: var(--accent); }
.op {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0.65rem;
  margin-bottom: 0.8rem;
  overflow: hidden;
}
.op.open { border-color: var(--border-hi); }
.op-head {
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  user-select: none;
}
.op-head:hover { background: rgba(255, 255, 255, 0.02); }
.method {
  font-weight: 700;
  font-size: 0.72rem;
  text-transform: uppercase;
  padding: 0.24rem 0.55rem;
  border-radius: 0.35rem;
  min-width: 64px;
  text-align: center;
  color: #fff;
}
.m-get { background: #0284c7; }
.m-post { background: #16a34a; }
.m-put, .m-patch { background: #d97706; }
.m-delete { background: #dc2626; }
.m-head { background: #7c3aed; }
.m-options { background: #475569; }
.schemas-heading { margin: 2.25rem 0 0.85rem; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
.m-schema { background: #334155; }
.path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; font-size: 0.9rem; }
.auth-pill { font-size: 0.7rem; color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.35); padding: 0.1rem 0.45rem; border-radius: 0.3rem; }
.summary { color: var(--muted); font-size: 0.84rem; margin-left: auto; }
.op-body { padding: 1rem; border-top: 1px solid var(--border); display: none; background: var(--panel-alt); }
.op.open .op-body { display: block; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 860px) { .split { grid-template-columns: 1fr; } }
.section-title { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 0.6rem; font-weight: 700; }
.param-row { display: grid; grid-template-columns: 140px 1fr; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
.param-name { font-family: ui-monospace, monospace; font-size: 0.8rem; }
.param-meta { color: var(--muted); font-size: 0.7rem; display: block; }
.btn-send {
  background: #0284c7;
  color: #fff;
  border: none;
  padding: 0.55rem 1rem;
  border-radius: 0.45rem;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  margin-top: 0.5rem;
}
.btn-send:hover { background: #0369a1; }
.res-meta { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; font-size: 0.8rem; }
.status-pill { padding: 0.15rem 0.5rem; border-radius: 0.3rem; font-weight: 700; font-family: ui-monospace, monospace; }
.s-ok { background: rgba(34, 197, 94, 0.18); color: #4ade80; }
.s-warn { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
.s-err { background: rgba(239, 68, 68, 0.18); color: #f87171; }
pre {
  background: #050811;
  border: 1px solid var(--border);
  padding: 0.75rem;
  border-radius: 0.45rem;
  overflow-x: auto;
  font-size: 0.78rem;
  color: #e2e8f0;
  margin: 0 0 0.75rem;
  max-height: 340px;
}
.hidden { display: none; }
.btn-row { display: flex; gap: 0.5rem; margin-top: 0.65rem; flex-wrap: wrap; }
.btn-row .btn-send { margin-top: 0; flex: 1 1 auto; }
.btn-copy {
  background: var(--panel-alt);
  color: var(--text);
  border: 1px solid var(--border-hi);
  padding: 0.52rem 0.85rem;
  border-radius: 0.45rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.btn-copy:hover { border-color: var(--accent); color: var(--accent); }
.empty-note { color: var(--muted); font-size: 0.85rem; padding: 1.5rem; text-align: center; border: 1px dashed var(--border-hi); border-radius: 0.6rem; }
`;

  const scriptContent = `
const spec = ${serializedSpec};
const root = document.getElementById('endpoints');
const filterInput = document.getElementById('filter');
const tokenInput = document.getElementById('bearer-token');
const tagsBar = document.getElementById('tags-bar');
let activeTag = 'All';

const entries = [];
const tagNames = new Set(['All']);
for (const [p, methods] of Object.entries(spec.paths || {})) {
  for (const [m, op] of Object.entries(methods || {})) {
    const tags = Array.isArray(op.tags) && op.tags.length ? op.tags : ['Default'];
    tags.forEach((t) => tagNames.add(t));
    entries.push({ path: p, method: m, op, tags });
  }
}

function sampleFromSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 8) return {};
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/components/schemas/')) {
    const refName = schema.$ref.slice('#/components/schemas/'.length);
    const resolved = spec.components && spec.components.schemas ? spec.components.schemas[refName] : undefined;
    return resolved ? sampleFromSchema(resolved, depth + 1) : {};
  }
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === 'string') {
    if (schema.format === 'email') return 'ada@example.com';
    if (schema.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
    if (schema.format === 'date-time') return '2026-10-29T12:00:00.000Z';
    return schema.minLength && schema.minLength > 4 ? 'Sample Value' : 'sample';
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return typeof schema.minimum === 'number' ? schema.minimum : 1;
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [sampleFromSchema(schema.items || { type: 'string' }, depth + 1)];
  if (schema.type === 'object' || schema.properties) {
    const out = {};
    for (const [k, prop] of Object.entries(schema.properties || {})) {
      out[k] = sampleFromSchema(prop, depth + 1);
    }
    return out;
  }
  return {};
}

function renderTags() {
  tagsBar.innerHTML = '';
  for (const tag of tagNames) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-pill' + (tag === activeTag ? ' active' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      activeTag = tag;
      renderTags();
      renderEndpoints(filterInput.value);
    });
    tagsBar.appendChild(btn);
  }
}

function renderEndpoints(queryText = '') {
  const needle = queryText.trim().toLowerCase();
  root.innerHTML = '';
  let visibleCount = 0;

  for (const item of entries) {
    if (activeTag !== 'All' && !item.tags.includes(activeTag)) continue;
    const hay = (item.method + ' ' + item.path + ' ' + (item.op.summary || '') + ' ' + item.tags.join(' ')).toLowerCase();
    if (needle && !hay.includes(needle)) continue;
    visibleCount += 1;

    const card = document.createElement('div');
    card.className = 'op';

    const head = document.createElement('div');
    head.className = 'op-head';

    const methodBadge = document.createElement('span');
    methodBadge.className = 'method m-' + item.method;
    methodBadge.textContent = item.method;
    head.appendChild(methodBadge);

    const pathSpan = document.createElement('span');
    pathSpan.className = 'path';
    pathSpan.textContent = item.path;
    head.appendChild(pathSpan);

    const requiresAuth = Array.isArray(item.op.security) && item.op.security.length > 0;
    if (requiresAuth) {
      const authBadge = document.createElement('span');
      authBadge.className = 'auth-pill';
      authBadge.textContent = 'Bearer Auth';
      head.appendChild(authBadge);
    }

    const summarySpan = document.createElement('span');
    summarySpan.className = 'summary';
    summarySpan.textContent = item.op.summary || item.tags[0] || '';
    head.appendChild(summarySpan);

    const body = document.createElement('div');
    body.className = 'op-body';

    const split = document.createElement('div');
    split.className = 'split';

    const leftCol = document.createElement('div');
    const tryTitle = document.createElement('h4');
    tryTitle.className = 'section-title';
    tryTitle.textContent = 'Try It Out — Live Request';
    leftCol.appendChild(tryTitle);

    const paramInputs = [];
    const params = Array.isArray(item.op.parameters) ? item.op.parameters : [];
    for (const p of params) {
      const row = document.createElement('div');
      row.className = 'param-row';
      const labelWrap = document.createElement('div');
      const nameEl = document.createElement('span');
      nameEl.className = 'param-name';
      nameEl.textContent = p.name + (p.required ? ' *' : '');
      const metaEl = document.createElement('span');
      metaEl.className = 'param-meta';
      metaEl.textContent = p.in + (p.schema && p.schema.type ? ' · ' + p.schema.type : '');
      labelWrap.appendChild(nameEl);
      labelWrap.appendChild(metaEl);

      const inputEl = document.createElement('input');
      inputEl.placeholder = p.description || p.name;
      if (p.schema && p.schema.default !== undefined) {
        inputEl.value = String(p.schema.default);
      }
      row.appendChild(labelWrap);
      row.appendChild(inputEl);
      leftCol.appendChild(row);
      paramInputs.push({ def: p, el: inputEl });
    }

    let bodyTextarea = null;
    const reqSchema = item.op.requestBody &&
      item.op.requestBody.content &&
      item.op.requestBody.content['application/json'] &&
      item.op.requestBody.content['application/json'].schema;

    if (reqSchema) {
      const bodyLabel = document.createElement('div');
      bodyLabel.className = 'control-label';
      bodyLabel.textContent = 'JSON Request Body';
      leftCol.appendChild(bodyLabel);
      bodyTextarea = document.createElement('textarea');
      bodyTextarea.value = JSON.stringify(sampleFromSchema(reqSchema), null, 2);
      leftCol.appendChild(bodyTextarea);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn-send';
    sendBtn.textContent = 'Send ' + item.method.toUpperCase() + ' Request';
    btnRow.appendChild(sendBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-copy';
    copyBtn.textContent = 'Copy curl';
    btnRow.appendChild(copyBtn);

    leftCol.appendChild(btnRow);

    function buildRequestParts() {
      let resolvedPath = item.path;
      const queryPairs = [];
      const isSseOp = Boolean(
        item.op.responses &&
        item.op.responses['200'] &&
        item.op.responses['200'].content &&
        item.op.responses['200'].content['text/event-stream']
      );
      const headers = { Accept: isSseOp ? 'text/event-stream' : 'application/json' };

      const bearer = tokenInput.value.trim();
      if (bearer) {
        headers['Authorization'] = bearer.startsWith('Bearer ') ? bearer : 'Bearer ' + bearer;
      }

      for (const { def, el } of paramInputs) {
        const val = el.value.trim();
        if (def.in === 'path') {
          resolvedPath = resolvedPath.replace('{' + def.name + '}', encodeURIComponent(val || 'missing'));
        } else if (def.in === 'query' && val !== '') {
          queryPairs.push(encodeURIComponent(def.name) + '=' + encodeURIComponent(val));
        } else if (def.in === 'header' && val !== '') {
          headers[def.name] = val;
        }
      }

      const url = resolvedPath + (queryPairs.length ? '?' + queryPairs.join('&') : '');
      const init = { method: item.method.toUpperCase(), headers };
      if (bodyTextarea) {
        headers['Content-Type'] = 'application/json';
        init.body = bodyTextarea.value;
      }
      return { url, init, headers, isSseOp };
    }

    copyBtn.addEventListener('click', async () => {
      const { url, init, headers } = buildRequestParts();
      const absUrl = window.location.origin + url;
      const parts = ['curl -X ' + init.method];
      for (const [hk, hv] of Object.entries(headers)) {
        parts.push('-H ' + JSON.stringify(hk + ': ' + hv));
      }
      if (init.body) {
        parts.push('-d ' + JSON.stringify(init.body));
      }
      parts.push(JSON.stringify(absUrl));
      try {
        await navigator.clipboard.writeText(parts.join(' \\\n  '));
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy curl'; }, 1400);
      } catch {}
    });

    const rightCol = document.createElement('div');
    const resWrap = document.createElement('div');
    resWrap.className = 'hidden';

    const resTitle = document.createElement('h4');
    resTitle.className = 'section-title';
    resTitle.textContent = 'Live Response';
    resWrap.appendChild(resTitle);

    const resMeta = document.createElement('div');
    resMeta.className = 'res-meta';
    const statusPill = document.createElement('span');
    statusPill.className = 'status-pill';
    const timingSpan = document.createElement('span');
    resMeta.appendChild(statusPill);
    resMeta.appendChild(timingSpan);
    resWrap.appendChild(resMeta);

    const resBodyPre = document.createElement('pre');
    resWrap.appendChild(resBodyPre);

    const resHeadersTitle = document.createElement('h4');
    resHeadersTitle.className = 'section-title';
    resHeadersTitle.textContent = 'Response Headers';
    resWrap.appendChild(resHeadersTitle);

    const resHeadersPre = document.createElement('pre');
    resWrap.appendChild(resHeadersPre);
    rightCol.appendChild(resWrap);

    const contractTitle = document.createElement('h4');
    contractTitle.className = 'section-title';
    contractTitle.textContent = 'OpenAPI 3.1 Operation Contract';
    rightCol.appendChild(contractTitle);

    const contractPre = document.createElement('pre');
    contractPre.textContent = JSON.stringify(item.op, null, 2);
    rightCol.appendChild(contractPre);

    sendBtn.addEventListener('click', async () => {
      const { url, init, isSseOp } = buildRequestParts();

      sendBtn.textContent = 'Sending...';
      const t0 = performance.now();
      try {
        const res = await fetch(url, init);
        const elapsed = (performance.now() - t0).toFixed(1);
        const contentType = res.headers.get('content-type') || '';

        statusPill.textContent = res.status + ' ' + (res.statusText || '');
        statusPill.className = 'status-pill ' + (res.status < 300 ? 's-ok' : res.status < 500 ? 's-warn' : 's-err');
        timingSpan.textContent = elapsed + ' ms';

        const headerLines = [];
        res.headers.forEach((v, k) => headerLines.push(k + ': ' + v));
        resHeadersPre.textContent = headerLines.join('\\n');
        resWrap.classList.remove('hidden');

        if ((isSseOp || contentType.includes('text/event-stream')) && res.body) {
          resBodyPre.textContent = '';
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let chunks = 0;
          while (chunks < 25) {
            const { value, done } = await reader.read();
            if (done) break;
            resBodyPre.textContent += decoder.decode(value, { stream: true });
            chunks += 1;
          }
          await reader.cancel();
        } else {
          const rawText = await res.text();
          let formatted = rawText;
          try {
            formatted = JSON.stringify(JSON.parse(rawText), null, 2);
          } catch {}
          resBodyPre.textContent = formatted || '(empty body)';
        }
      } catch (err) {
        statusPill.textContent = 'Network Error';
        statusPill.className = 'status-pill s-err';
        resBodyPre.textContent = String(err);
        resWrap.classList.remove('hidden');
      } finally {
        sendBtn.textContent = 'Send ' + item.method.toUpperCase() + ' Request';
      }
    });

    split.appendChild(leftCol);
    split.appendChild(rightCol);
    body.appendChild(split);

    head.addEventListener('click', () => card.classList.toggle('open'));
    card.appendChild(head);
    card.appendChild(body);
    root.appendChild(card);
  }

  if (visibleCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'No endpoints match your filter.';
    root.appendChild(empty);
  }
}

const schemasRoot = document.getElementById('schemas');

function renderSchemas() {
  if (!schemasRoot) return;
  const schemasMap = (spec.components && spec.components.schemas) || {};
  const names = Object.keys(schemasMap);
  schemasRoot.innerHTML = '';
  if (names.length === 0) return;

  const heading = document.createElement('div');
  heading.className = 'schemas-heading';
  heading.textContent = 'Component Schemas (' + names.length + ')';
  schemasRoot.appendChild(heading);

  for (const name of names) {
    const schemaDef = schemasMap[name];
    const card = document.createElement('div');
    card.className = 'op';

    const head = document.createElement('div');
    head.className = 'op-head';

    const badge = document.createElement('span');
    badge.className = 'method m-schema';
    badge.textContent = 'SCHEMA';
    head.appendChild(badge);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'path';
    nameSpan.textContent = name;
    head.appendChild(nameSpan);

    const descSpan = document.createElement('span');
    descSpan.className = 'summary';
    descSpan.textContent = (schemaDef && schemaDef.description) || '#/components/schemas/' + name;
    head.appendChild(descSpan);

    const body = document.createElement('div');
    body.className = 'op-body';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(schemaDef, null, 2);
    body.appendChild(pre);

    head.addEventListener('click', () => card.classList.toggle('open'));
    card.appendChild(head);
    card.appendChild(body);
    schemasRoot.appendChild(card);
  }
}

filterInput.addEventListener('input', (e) => renderEndpoints(e.target.value));
renderTags();
renderEndpoints();
renderSchemas();
`;

  const styleHash = sha256Base64(styleContent);
  const scriptHash = sha256Base64(scriptContent);
  const frameDirective =
    frameOptions === 'DENY'
      ? "; frame-ancestors 'none'"
      : frameOptions === 'SAMEORIGIN'
        ? "; frame-ancestors 'self'"
        : '';

  const cspHeader =
    `default-src 'self'; connect-src 'self'; style-src 'sha256-${styleHash}'; ` +
    `script-src 'sha256-${scriptHash}'${frameDirective}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — OpenAPI 3.1 Explorer</title>
  <style>${styleContent}</style>
</head>
<body>
  <header>
    <div>
      <div class="brand-row">
        <span class="brand-title">${title}</span>
        <span class="badge">v${version}</span>
        <span class="badge">OpenAPI ${doc.openapi}</span>
      </div>
      ${description ? `<div class="brand-desc">${description}</div>` : ''}
    </div>
    <a class="raw-link" href="${escapeHtml(jsonUrl)}">OpenAPI JSON (${escapeHtml(jsonUrl)})</a>
  </header>
  <main>
    <div class="controls-grid">
      <div class="control-box">
        <label class="control-label" for="filter">Search Endpoints</label>
        <input id="filter" type="search" placeholder="Filter by path, method, summary, or tag..." />
      </div>
      <div class="control-box">
        <label class="control-label" for="bearer-token">Authorization (Bearer Token)</label>
        <input id="bearer-token" type="text" placeholder="Optional token sent as Authorization: Bearer <token>" />
      </div>
    </div>
    <div id="tags-bar" class="tags-bar"></div>
    <div id="endpoints"></div>
    <div id="schemas"></div>
  </main>
  <script>${scriptContent}</script>
</body>
</html>`;

  return { html, cspHeader };
}

/**
 * Mounts `/docs/openapi.json` (raw OpenAPI 3.1 JSON) and content-negotiated `/docs`
 * (returns OpenAPI 3.1 JSON to API clients, or a zero-CDN interactive playground with
 * strict SHA-256 CSP hashes to browsers).
 */
export function mountOpenApiDocs(
  expressApp: Application,
  doc: OpenApiDocument,
  options: OpenApiOptions = {},
  frameOptions: 'DENY' | 'SAMEORIGIN' | false = 'DENY',
): void {
  if (options.enabled === false) {
    return;
  }

  const basePath = (options.path ?? '/docs').replace(/\/+$/g, '') || '/docs';
  const jsonPath = `${basePath}/openapi.json`;
  const uiEnabled = options.ui ?? true;
  const serializedJson = JSON.stringify(doc);
  const compiled = uiEnabled ? compileExplorerAssets(doc, jsonPath, frameOptions) : null;

  expressApp.get(jsonPath, (_req, res) => {
    res.status(200).type('application/json; charset=utf-8').send(serializedJson);
  });

  expressApp.get(basePath, (req, res) => {
    const acceptHeader = req.headers.accept ?? '';
    const wantsHtml =
      compiled !== null &&
      acceptHeader.includes('text/html') &&
      !acceptHeader.startsWith('application/json');

    if (wantsHtml && compiled !== null) {
      res.setHeader('Content-Security-Policy', compiled.cspHeader);
      res.status(200).type('text/html; charset=utf-8').send(compiled.html);
      return;
    }

    res.status(200).type('application/json; charset=utf-8').send(serializedJson);
  });
}
