import { describe, expect, it } from 'vitest';

import { SecretRedactor } from './redaction.js';

describe('SecretRedactor', () => {
  it('redacts known values, authorization forms, and sensitive fields', () => {
    const redactor = new SecretRedactor(['provider-secret']);

    expect(
      redactor.redact({
        apiKey: 'provider-secret',
        message: 'Bearer abc.def and provider-secret',
        safe: 'visible',
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      message: '[REDACTED] and [REDACTED]',
      safe: 'visible',
    });
  });

  it('rejects known secret values before persistence', () => {
    const redactor = new SecretRedactor(['provider-secret']);

    const error = captureError(() =>
      redactor.assertSafe({ reason: 'provider-secret' }, 'test data'),
    );
    expect(error).toMatchObject({ code: 'unsafe_persistence_value' });
    expect(String(error)).not.toContain('provider-secret');
    expect(() =>
      redactor.assertBytesSafe(
        new TextEncoder().encode('provider-secret'),
        'test artifact',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'unsafe_persistence_value' }),
    );
    expect(() =>
      redactor.assertSafe({ authorization: 'unknown-value' }, 'test data'),
    ).toThrowError(
      expect.objectContaining({ code: 'unsafe_persistence_value' }),
    );
  });
});

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected action to throw.');
}
