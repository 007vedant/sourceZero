export type PersistenceErrorCode =
  | 'investigation_already_exists'
  | 'investigation_not_found'
  | 'stale_event_sequence'
  | 'duplicate_event_id'
  | 'invalid_event_causation'
  | 'invalid_persistence_data'
  | 'unsupported_format_version'
  | 'persistence_closed'
  | 'artifact_too_large'
  | 'artifact_integrity_failure'
  | 'artifact_metadata_conflict';

export class PersistenceError extends Error {
  public constructor(
    public readonly code: PersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PersistenceError';
  }
}
