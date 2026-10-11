/** Enforces the public-network boundary shared by HTTP and browser retrieval. */

import { lookup as nodeLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type AddressResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly ResolvedAddress[]>;

export interface PublicNetworkPolicyOptions {
  readonly maximumUrlLength?: number;
  readonly resolve?: AddressResolver;
}

export class NetworkPolicyError extends Error {
  public constructor(
    public readonly code:
      | 'invalid_url'
      | 'unsupported_protocol'
      | 'embedded_credentials'
      | 'blocked_destination'
      | 'dns_failure',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'NetworkPolicyError';
  }
}

/** Resolves every hop and pins callers to addresses that passed policy. */
export class PublicNetworkPolicy {
  readonly #maximumUrlLength: number;
  readonly #resolve: AddressResolver;

  public constructor(options: PublicNetworkPolicyOptions = {}) {
    this.#maximumUrlLength = options.maximumUrlLength ?? 2_048;
    this.#resolve = options.resolve ?? resolveAddresses;
  }

  public async inspect(
    value: string,
    signal: AbortSignal,
  ): Promise<{
    readonly url: URL;
    readonly addresses: readonly ResolvedAddress[];
  }> {
    signal.throwIfAborted();
    if (value.length > this.#maximumUrlLength) {
      throw new NetworkPolicyError(
        'invalid_url',
        'URL exceeds the configured length limit.',
      );
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch (error: unknown) {
      throw new NetworkPolicyError('invalid_url', 'URL is not valid.', {
        cause: error,
      });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new NetworkPolicyError(
        'unsupported_protocol',
        'Only HTTP and HTTPS destinations are allowed.',
      );
    }
    if (url.username.length > 0 || url.password.length > 0) {
      throw new NetworkPolicyError(
        'embedded_credentials',
        'Credentials embedded in URLs are forbidden.',
      );
    }
    const hostname =
      url.hostname.startsWith('[') && url.hostname.endsWith(']')
        ? url.hostname.slice(1, -1)
        : url.hostname;
    const literalFamily: 0 | 4 | 6 = ipaddr.isValid(hostname)
      ? ipaddr.parse(hostname).kind() === 'ipv4'
        ? 4
        : 6
      : 0;
    const addresses =
      literalFamily === 0
        ? await this.#resolve(hostname, signal)
        : [{ address: hostname, family: literalFamily }];
    if (addresses.length === 0) {
      throw new NetworkPolicyError(
        'dns_failure',
        'Destination did not resolve to an address.',
      );
    }
    for (const address of addresses) {
      if (
        !ipaddr.isValid(address.address) ||
        ipaddr.parse(address.address).range() !== 'unicast'
      ) {
        throw new NetworkPolicyError(
          'blocked_destination',
          'Destination resolves to a non-public address.',
        );
      }
    }
    return { url, addresses };
  }
}

async function resolveAddresses(
  hostname: string,
  signal: AbortSignal,
): Promise<readonly ResolvedAddress[]> {
  try {
    const answers = await nodeLookup(hostname, { all: true, verbatim: true });
    signal.throwIfAborted();
    return answers.map((answer) => {
      if (answer.family !== 4 && answer.family !== 6) {
        throw new NetworkPolicyError(
          'dns_failure',
          'DNS returned an unsupported address family.',
        );
      }
      return { address: answer.address, family: answer.family };
    });
  } catch (error: unknown) {
    if (signal.aborted) signal.throwIfAborted();
    throw new NetworkPolicyError(
      'dns_failure',
      'Destination DNS resolution failed.',
      { cause: error },
    );
  }
}
