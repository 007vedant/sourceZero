export type RuntimeErrorCode =
  | 'duplicate_plugin_id'
  | 'duplicate_service_owner'
  | 'missing_dependency'
  | 'dependency_cycle'
  | 'undeclared_service_registration'
  | 'service_not_registered'
  | 'service_unavailable'
  | 'runtime_disposed'
  | 'plugin_setup_failed'
  | 'plugin_disposal_failed'
  | 'invalid_configuration';

export class RuntimeError extends Error {
  public constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}
