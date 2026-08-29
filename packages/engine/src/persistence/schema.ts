import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const investigations = sqliteTable('investigations', {
  id: text('id').primaryKey(),
  formatVersion: integer('format_version').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastSequence: integer('last_sequence').notNull().default(0),
});

export const investigationEvents = sqliteTable(
  'investigation_events',
  {
    investigationId: text('investigation_id')
      .notNull()
      .references(() => investigations.id),
    sequence: integer('sequence').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    producerJson: text('producer_json').notNull(),
    causationId: text('causation_id'),
    correlationId: text('correlation_id'),
    dataJson: text('data_json').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.investigationId, table.sequence] }),
    uniqueIndex('investigation_events_event_id_unique').on(table.eventId),
  ],
);

export const projectionCheckpoints = sqliteTable(
  'projection_checkpoints',
  {
    investigationId: text('investigation_id')
      .notNull()
      .references(() => investigations.id),
    projectionId: text('projection_id').notNull(),
    projectionVersion: integer('projection_version').notNull(),
    lastSequence: integer('last_sequence').notNull(),
    stateJson: text('state_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.investigationId, table.projectionId] }),
  ],
);

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  algorithm: text('algorithm').notNull(),
  mediaType: text('media_type').notNull(),
  byteLength: integer('byte_length').notNull(),
  createdAt: text('created_at').notNull(),
  retentionClass: text('retention_class').notNull(),
  relativeLocation: text('relative_location').notNull().unique(),
  formatVersion: integer('format_version').notNull(),
});
