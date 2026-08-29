import { describe, expect, it } from 'vitest';

import { createInvestigationId } from './identifiers.js';
import { investigationEventSchema, materializeEvent } from './events.js';
import { investigationCreatedDraft } from '../persistence/test-fixtures.js';

describe('investigation events', () => {
  it('materializes and losslessly validates a versioned event', () => {
    const event = materializeEvent(
      createInvestigationId(),
      1,
      investigationCreatedDraft(),
    );

    expect(
      investigationEventSchema.parse(JSON.parse(JSON.stringify(event))),
    ).toEqual(event);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.data)).toBe(true);
  });

  it('rejects unknown event fields and unsupported versions', () => {
    const event = materializeEvent(
      createInvestigationId(),
      1,
      investigationCreatedDraft(),
    );

    expect(() =>
      investigationEventSchema.parse({ ...event, schemaVersion: 2 }),
    ).toThrow();
    expect(() =>
      investigationEventSchema.parse({ ...event, authorization: 'secret' }),
    ).toThrow();
  });
});
