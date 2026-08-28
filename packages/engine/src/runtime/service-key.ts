const serviceKeyBrand: unique symbol = Symbol('SourceZeroServiceKey');

export interface ServiceKey<T> {
  readonly id: string;
  readonly [serviceKeyBrand]: T | undefined;
}

export function createServiceKey<T>(id: string): ServiceKey<T> {
  const normalizedId = id.trim();
  if (normalizedId.length === 0) {
    throw new TypeError('Service key ID must not be empty.');
  }

  return Object.freeze({
    id: normalizedId,
    [serviceKeyBrand]: undefined,
  });
}
