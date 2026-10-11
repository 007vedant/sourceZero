/** Verifies denial-first destination classification for retrieval. */

import { describe, expect, it } from 'vitest';

import { NetworkPolicyError, PublicNetworkPolicy } from './network-policy.js';

describe('PublicNetworkPolicy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '224.0.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ])('rejects non-public address %s', async (address) => {
    const policy = new PublicNetworkPolicy();
    await expect(
      policy.inspect(
        `http://${address.includes(':') ? `[${address}]` : address}/`,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'blocked_destination',
    } satisfies Partial<NetworkPolicyError>);
  });

  it('rejects unsupported protocols, embedded credentials, and mixed DNS answers', async () => {
    const policy = new PublicNetworkPolicy({
      resolve: () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]),
    });
    await expect(
      policy.inspect('file:///etc/passwd', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'unsupported_protocol' });
    await expect(
      policy.inspect(
        'https://user:secret@example.com/',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'embedded_credentials' });
    await expect(
      policy.inspect('https://example.com/', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'blocked_destination' });
  });

  it('accepts a hostname only when every resolved address is public', async () => {
    const policy = new PublicNetworkPolicy({
      resolve: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
    });
    await expect(
      policy.inspect('https://example.com/path', new AbortController().signal),
    ).resolves.toMatchObject({
      url: expect.objectContaining({ hostname: 'example.com' }),
    });
  });
});
