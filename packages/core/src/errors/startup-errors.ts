/**
 * Base class for deterministic startup / bootstrap configuration failures.
 * Thrown during `BetterBack.create()` BEFORE any HTTP port begins listening.
 */
export class BootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigValidationError extends BootstrapError {
  public readonly issues: readonly { readonly path: string; readonly message: string }[];

  public constructor(issues: readonly { readonly path: string; readonly message: string }[]) {
    const formatted = issues.map((i) => `  - ${i.path || '<root>'}: ${i.message}`).join('\n');
    super('CONFIG_VALIDATION_ERROR', `Configuration validation failed at startup:\n${formatted}`);
    this.issues = issues;
  }
}

export class CircularDependencyError extends BootstrapError {
  public readonly cyclePath: readonly string[];

  public constructor(kind: 'module' | 'provider', cyclePath: readonly string[], context?: string) {
    const scopePrefix = context ? ` in module "${context}"` : '';
    super(
      'CIRCULAR_DEPENDENCY_ERROR',
      `Circular ${kind} dependency detected${scopePrefix}: ${cyclePath.join(' -> ')}`,
    );
    this.cyclePath = cyclePath;
  }
}

export class DuplicateProviderError extends BootstrapError {
  public constructor(moduleName: string, tokenName: string) {
    super(
      'DUPLICATE_PROVIDER_ERROR',
      `Duplicate provider registration in module "${moduleName}" for token "${tokenName}". Each token may only be registered once per module.`,
    );
  }
}

export class MissingProviderError extends BootstrapError {
  public constructor(options: {
    readonly moduleName: string;
    readonly consumerName: string;
    readonly tokenName: string;
    readonly unexportedOwnerModule?: string;
  }) {
    const hint = options.unexportedOwnerModule
      ? ` Hint: "${options.tokenName}" is registered in module "${options.unexportedOwnerModule}" — ensure "${options.moduleName}" imports "${options.unexportedOwnerModule}" AND "${options.unexportedOwnerModule}" includes "${options.tokenName}" in its exports.`
      : ` Register a provider for "${options.tokenName}" in "${options.moduleName}" or import a module that exports it.`;
    super(
      'MISSING_PROVIDER_ERROR',
      `Cannot resolve dependency "${options.tokenName}" required by "${options.consumerName}" in module "${options.moduleName}".${hint}`,
    );
  }
}

export class DuplicateRouteError extends BootstrapError {
  public constructor(signature: string, firstOwner: string, secondOwner: string) {
    super(
      'DUPLICATE_ROUTE_ERROR',
      `Duplicate route "${signature}" detected at startup: registered by both "${firstOwner}" and "${secondOwner}".`,
    );
  }
}

export class SecurityConfigError extends BootstrapError {
  public constructor(message: string) {
    super('SECURITY_CONFIG_ERROR', `Invalid security configuration: ${message}`);
  }
}
