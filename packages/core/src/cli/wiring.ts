/**
 * Deterministically inserts an ES import and appends a symbol into an `@Module({...})`
 * metadata array (`imports`, `controllers`, `providers`, or `exports`) without AST dependencies.
 * Idempotent: returns the original source unchanged if already wired.
 */
export function wireSymbolIntoModuleSource(options: {
  readonly source: string;
  readonly symbolName: string;
  readonly importPath: string;
  readonly arrayField: 'imports' | 'controllers' | 'providers' | 'exports';
}): { readonly updated: string; readonly changed: boolean } {
  const { source, symbolName, importPath, arrayField } = options;

  if (!source.includes('@Module')) {
    return { updated: source, changed: false };
  }

  let next = source;
  const importStatement = `import { ${symbolName} } from '${importPath}';`;

  // 1. Add ES import if symbol is not already imported
  const alreadyImported = new RegExp(`\\b${symbolName}\\b`).test(next.split('@Module')[0] ?? '');
  if (!alreadyImported) {
    const importRegex = /^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm;
    let lastMatchEnd = -1;
    let match = importRegex.exec(next);
    while (match !== null) {
      lastMatchEnd = match.index + match[0].length;
      match = importRegex.exec(next);
    }
    if (lastMatchEnd >= 0) {
      next = `${next.slice(0, lastMatchEnd)}\n${importStatement}${next.slice(lastMatchEnd)}`;
    } else {
      next = `${importStatement}\n${next}`;
    }
  }

  // 2. Handle empty `@Module()` or `@Module({})`
  if (/@Module\(\s*\)/.test(next)) {
    next = next.replace(/@Module\(\s*\)/, `@Module({\n  ${arrayField}: [${symbolName}],\n})`);
    return { updated: next, changed: next !== source };
  }
  if (/@Module\(\s*\{\s*\}\s*\)/.test(next)) {
    next = next.replace(
      /@Module\(\s*\{\s*\}\s*\)/,
      `@Module({\n  ${arrayField}: [${symbolName}],\n})`,
    );
    return { updated: next, changed: next !== source };
  }

  // 3. Locate `@Module({ ... })` block and update existing `arrayField: [...]` or insert it
  const fieldRegex = new RegExp(`(${arrayField}\\s*:\\s*\\[)([^\\]]*)(\\])`);
  const existingField = fieldRegex.exec(next);
  if (existingField) {
    const inner = existingField[2] ?? '';
    if (new RegExp(`\\b${symbolName}\\b`).test(inner)) {
      return { updated: next, changed: next !== source };
    }
    const trimmedInner = inner.trim();
    const cleanedInner = trimmedInner.replace(/,\s*$/, '');
    const replacementInner =
      cleanedInner.length === 0 ? symbolName : `${cleanedInner}, ${symbolName}`;
    next = next.replace(fieldRegex, `$1${replacementInner}$3`);
    return { updated: next, changed: next !== source };
  }

  // Insert new `arrayField: [symbolName],` at top of `@Module({`
  next = next.replace(/@Module\(\s*\{/, `@Module({\n  ${arrayField}: [${symbolName}],`);
  return { updated: next, changed: next !== source };
}
