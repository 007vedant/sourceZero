import { RuntimeError } from '../runtime/errors.js';

const sensitiveKeyPattern =
  /(?:authorization|cookie|credential|password|api[-_]?key|access[-_]?token|refresh[-_]?token|secret)/iu;
const credentialTextPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu,
  /\bBasic\s+[A-Za-z0-9+/=]+/giu,
] as const;

export class SecretRedactor {
  readonly #secrets: readonly string[];

  public constructor(secrets: readonly string[] = []) {
    this.#secrets = [
      ...new Set(secrets.filter((secret) => secret.length > 0)),
    ].sort((left, right) => right.length - left.length);
  }

  public redactText(text: string): string {
    let redacted = text;
    for (const secret of this.#secrets) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
    for (const pattern of credentialTextPatterns) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }

  public redact(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redactText(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          sensitiveKeyPattern.test(key) ? '[REDACTED]' : this.redact(item),
        ]),
      );
    }
    return value;
  }

  public assertSafe(value: unknown, context: string): void {
    if (containsSensitiveKey(value)) {
      throw unsafePersistenceError(context);
    }
    const serialized = JSON.stringify({ value });
    this.assertTextSafe(serialized, context);
  }

  public assertBytesSafe(bytes: Uint8Array, context: string): void {
    const content = Buffer.from(bytes);
    for (const secret of this.#secrets) {
      if (content.indexOf(Buffer.from(secret)) !== -1) {
        throw unsafePersistenceError(context);
      }
    }
  }

  private assertTextSafe(text: string, context: string): void {
    if (this.redactText(text) !== text) {
      throw unsafePersistenceError(context);
    }
  }
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveKey(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, item]) =>
        sensitiveKeyPattern.test(key) || containsSensitiveKey(item),
    );
  }
  return false;
}

function unsafePersistenceError(context: string): RuntimeError {
  return new RuntimeError(
    'unsafe_persistence_value',
    `Refused to persist a value containing credential material in ${context}.`,
  );
}
