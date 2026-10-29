export interface EntityNames {
  /** Singular kebab-case (`"order-item"`) */
  readonly singularKebab: string;
  /** Plural kebab-case (`"order-items"`) */
  readonly pluralKebab: string;
  /** Singular PascalCase (`"OrderItem"`) */
  readonly singularPascal: string;
  /** Plural PascalCase (`"OrderItems"`) */
  readonly pluralPascal: string;
  /** Singular camelCase (`"orderItem"`) */
  readonly singularCamel: string;
  /** Plural camelCase (`"orderItems"`) */
  readonly pluralCamel: string;
}

const IRREGULAR_SINGULAR_TO_PLURAL: Readonly<Record<string, string>> = {
  person: 'people',
  child: 'children',
  datum: 'data',
  medium: 'media',
  index: 'indices',
  matrix: 'matrices',
};

const IRREGULAR_PLURAL_TO_SINGULAR: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IRREGULAR_SINGULAR_TO_PLURAL).map(([s, p]) => [p, s]),
);

function splitWords(raw: string): string[] {
  const cleaned = raw
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (!cleaned) {
    throw new Error(`Invalid resource or module name "${raw}". Provide an alphanumeric name.`);
  }
  return cleaned.split('-').filter(Boolean);
}

function singularizeWord(word: string): string {
  const irregular = IRREGULAR_PLURAL_TO_SINGULAR[word];
  if (irregular) return irregular;
  if (word.endsWith('ies') && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }
  if (
    word.endsWith('ses') ||
    word.endsWith('xes') ||
    word.endsWith('zes') ||
    word.endsWith('ches') ||
    word.endsWith('shes')
  ) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 2) {
    return word.slice(0, -1);
  }
  return word;
}

function pluralizeWord(word: string): string {
  const irregular = IRREGULAR_SINGULAR_TO_PLURAL[word];
  if (irregular) return irregular;
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) {
    return word;
  }
  if (/[^aeiou]y$/.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/.test(word)) {
    return `${word}es`;
  }
  return `${word}s`;
}

function capitalize(word: string): string {
  return word.length === 0 ? '' : `${word[0]!.toUpperCase()}${word.slice(1)}`;
}

function toPascal(words: readonly string[]): string {
  return words.map(capitalize).join('');
}

function toCamel(words: readonly string[]): string {
  if (words.length === 0) return '';
  return `${words[0]!}${words.slice(1).map(capitalize).join('')}`;
}

/**
 * Normalizes any user-supplied name (`"users"`, `"User"`, `"orderItems"`, `"order-item"`)
 * into canonical singular & plural identifiers for files, classes, routes, and schemas.
 */
export function deriveEntityNames(rawInput: string): EntityNames {
  const words = splitWords(rawInput);
  const prefix = words.slice(0, -1);
  const lastWord = words[words.length - 1]!;

  const singularLast = singularizeWord(lastWord);
  const pluralLast = pluralizeWord(singularLast);

  const singularWords = [...prefix, singularLast];
  const pluralWords = [...prefix, pluralLast];

  return {
    singularKebab: singularWords.join('-'),
    pluralKebab: pluralWords.join('-'),
    singularPascal: toPascal(singularWords),
    pluralPascal: toPascal(pluralWords),
    singularCamel: toCamel(singularWords),
    pluralCamel: toCamel(pluralWords),
  };
}

export function normalizePackageSlug(rawInput: string): string {
  return splitWords(rawInput).join('-');
}
