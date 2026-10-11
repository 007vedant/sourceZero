/** Orchestrates bounded search and breadth-first public-source traversal. */

import {
  extractionResponseSchema,
  fetchResponseSchema,
  searchResponseSchema,
  ToolInvocationError,
  type HarnessEventRecorder,
  type ToolExecutor,
} from '../harness/index.js';
import {
  createSourceId,
  type EventId,
  type InvestigationId,
  type SourceId,
} from '../domain/identifiers.js';
import type { InvestigationApplicationService } from './investigation-service.js';

export interface SourceDiscoveryServiceOptions {
  readonly investigations: InvestigationApplicationService;
  readonly executor: ToolExecutor;
  readonly recorder: HarnessEventRecorder;
}

interface Candidate {
  readonly originalUrl: string;
  readonly normalizedUrl: string;
  readonly title: string;
  readonly snippet: string;
  readonly kind: 'search_result' | 'hyperlink' | 'citation';
  readonly depth: number;
  readonly parentSourceId?: SourceId;
  readonly leadEventId: EventId;
}

/** Records each discovery decision before delegating external work to tools. */
export class SourceDiscoveryService {
  readonly #investigations: InvestigationApplicationService;
  readonly #executor: ToolExecutor;
  readonly #recorder: HarnessEventRecorder;

  public constructor(options: SourceDiscoveryServiceOptions) {
    this.#investigations = options.investigations;
    this.#executor = options.executor;
    this.#recorder = options.recorder;
  }

  public async run(investigationId: InvestigationId, signal: AbortSignal) {
    const workspace = this.#investigations.showInvestigation(investigationId);
    if (workspace.overview.status !== 'running') {
      throw new Error('Source discovery requires a running investigation.');
    }
    const confirmed = workspace.framing.confirmedClaim;
    if (confirmed === undefined) {
      throw new Error('Source discovery requires a confirmed claim.');
    }
    const query = quoteQuery(confirmed.wording);
    const queryEvent = this.#recorder.append(investigationId, [
      {
        type: 'discovery.query_recorded',
        producer: { kind: 'system', component: 'application.source-discovery' },
        data: { query, reason: 'confirmed_claim', depth: 0 },
      },
    ])[0];
    if (queryEvent === undefined)
      throw new Error('Discovery query was not recorded.');
    let search;
    try {
      search = await this.#executor.execute({
        investigationId,
        toolName: 'provider.search.query',
        input: {
          operationId: operationId(investigationId, 'search', 0),
          query,
          limit: Math.min(
            workspace.budget.limits.maxRetrievedSources ?? 20,
            20,
          ),
        },
        signal,
        causationId: queryEvent.eventId,
      });
    } catch (error: unknown) {
      if (!(error instanceof ToolInvocationError)) throw error;
      if (error.code !== 'budget_exhausted' && error.code !== 'canceled') {
        throw error;
      }
      this.#recordQueryFailure(
        investigationId,
        query,
        error.code === 'budget_exhausted' ? 'budget_exhausted' : 'canceled',
        queryEvent.eventId,
      );
      return this.#investigations.showInvestigation(investigationId);
    }
    if (search.outcome === 'failed') {
      this.#recordQueryFailure(
        investigationId,
        query,
        search.failureCode,
        queryEvent.eventId,
      );
      return this.#investigations.showInvestigation(investigationId);
    }
    const results = searchResponseSchema.parse(search.output).results;
    const queue: Candidate[] = [];
    for (const result of results) {
      const candidate = this.#recordLead(
        investigationId,
        {
          originalUrl: result.url,
          title: result.title,
          snippet: result.snippet,
          kind: 'search_result',
          depth: 0,
        },
        queryEvent.eventId,
      );
      queue.push(candidate);
    }

    const seen = new Set<string>();
    let retrieved = 0;
    let operation = 1;
    while (queue.length > 0) {
      signal.throwIfAborted();
      const candidate = queue.shift();
      if (candidate === undefined) break;
      if (seen.has(candidate.normalizedUrl)) {
        this.#recordUnfollowed(
          investigationId,
          candidate,
          'duplicate',
          'Lead duplicates an already considered normalized URL.',
        );
        continue;
      }
      seen.add(candidate.normalizedUrl);
      const maxDepth = workspace.budget.limits.maxTraversalDepth ?? 0;
      if (candidate.depth > maxDepth) {
        this.#recordUnfollowed(
          investigationId,
          candidate,
          'depth_budget',
          'Lead exceeds the configured traversal depth.',
        );
        continue;
      }
      const maxSources = workspace.budget.limits.maxRetrievedSources ?? 1;
      if (retrieved >= maxSources) {
        this.#recordUnfollowed(
          investigationId,
          candidate,
          'source_budget',
          'Lead was not followed because the source budget is exhausted.',
        );
        continue;
      }
      let fetch;
      try {
        fetch = await this.#executor.execute({
          investigationId,
          toolName: 'provider.fetch.public_url',
          input: {
            operationId: operationId(investigationId, 'fetch', operation++),
            url: candidate.originalUrl,
          },
          signal,
          causationId: candidate.leadEventId,
        });
      } catch (error: unknown) {
        if (
          error instanceof ToolInvocationError &&
          error.code === 'budget_exhausted'
        ) {
          this.#recordUnfollowed(
            investigationId,
            candidate,
            'source_budget',
            'Lead was not followed because a tool budget is exhausted.',
          );
          continue;
        }
        throw error;
      }
      if (fetch.outcome === 'failed') {
        this.#recordUnfollowed(
          investigationId,
          candidate,
          'failed',
          `Retrieval failed with ${fetch.failureCode}.`,
        );
        continue;
      }
      const fetched = fetchResponseSchema.parse(fetch.output);
      if (fetched.outcome === 'rejected') {
        this.#recorder.append(investigationId, [
          {
            type: 'source.rejected',
            producer: {
              kind: 'system',
              component: 'application.source-discovery',
            },
            causationId: candidate.leadEventId,
            data: {
              originalUrl: candidate.originalUrl,
              normalizedUrl: candidate.normalizedUrl,
              depth: candidate.depth,
              code: fetched.code,
              message: fetched.message,
              redirects: fetched.redirects,
            },
          },
        ]);
        continue;
      }
      let extraction;
      try {
        extraction = await this.#executor.execute({
          investigationId,
          toolName: 'provider.extraction.readable_text',
          input: {
            operationId: operationId(investigationId, 'extract', operation++),
            artifactId: fetched.artifactId,
            mediaType: fetched.mediaType,
            documentUrl: fetched.resolvedUrl,
          },
          signal,
          causationId: candidate.leadEventId,
        });
      } catch (error: unknown) {
        if (
          error instanceof ToolInvocationError &&
          error.code === 'budget_exhausted'
        ) {
          this.#recordUnfollowed(
            investigationId,
            candidate,
            'source_budget',
            'Lead extraction was not scheduled because a tool budget is exhausted.',
          );
          continue;
        }
        throw error;
      }
      if (extraction.outcome === 'failed') {
        this.#recordUnfollowed(
          investigationId,
          candidate,
          'failed',
          `Extraction failed with ${extraction.failureCode}.`,
        );
        continue;
      }
      const extracted = extractionResponseSchema.parse(extraction.output);
      const sourceId = createSourceId();
      retrieved += 1;
      const sourceEvent = this.#recorder.append(investigationId, [
        {
          type: 'source.retrieved',
          producer: {
            kind: 'system',
            component: 'application.source-discovery',
          },
          causationId: candidate.leadEventId,
          data: {
            sourceId,
            originalUrl: candidate.originalUrl,
            normalizedUrl: candidate.normalizedUrl,
            resolvedUrl: fetched.resolvedUrl,
            depth: candidate.depth,
            status: fetched.status,
            mediaType: fetched.mediaType,
            fetchedArtifactId: fetched.artifactId,
            readableTextArtifactId: extracted.readableTextArtifactId,
            ...(extracted.renderedArtifactId === undefined
              ? {}
              : { renderedArtifactId: extracted.renderedArtifactId }),
            readableCharacterCount: extracted.readableCharacterCount,
            ...(extracted.title === undefined
              ? {}
              : { title: extracted.title }),
            redirects: fetched.redirects,
            extractionMethod: extracted.extractionMethod,
            links: extracted.links,
            namedSources: extracted.namedSources,
            exactPhrases: extracted.exactPhrases,
            metadata: extracted.metadata,
          },
        },
      ])[0];
      if (sourceEvent === undefined)
        throw new Error('Retrieved source was not recorded.');
      for (const link of extracted.links) {
        queue.push(
          this.#recordLead(
            investigationId,
            {
              originalUrl: link.url,
              title: link.text,
              snippet: '',
              kind: link.kind,
              depth: candidate.depth + 1,
              parentSourceId: sourceId,
            },
            sourceEvent.eventId,
          ),
        );
      }
    }
    return this.#investigations.showInvestigation(investigationId);
  }

  #recordLead(
    investigationId: InvestigationId,
    input: Omit<Candidate, 'normalizedUrl' | 'leadEventId'>,
    causationId: EventId,
  ): Candidate {
    const normalizedUrl = normalizeCandidateUrl(input.originalUrl);
    const event = this.#recorder.append(investigationId, [
      {
        type: 'discovery.lead_recorded',
        producer: { kind: 'system', component: 'application.source-discovery' },
        causationId,
        data: {
          originalUrl: input.originalUrl,
          normalizedUrl,
          title: input.title,
          snippet: input.snippet,
          kind: input.kind,
          depth: input.depth,
          ...(input.parentSourceId === undefined
            ? {}
            : { parentSourceId: input.parentSourceId }),
        },
      },
    ])[0];
    if (event === undefined)
      throw new Error('Discovery lead was not recorded.');
    return { ...input, normalizedUrl, leadEventId: event.eventId };
  }

  #recordUnfollowed(
    investigationId: InvestigationId,
    candidate: Candidate,
    reason: 'duplicate' | 'source_budget' | 'depth_budget' | 'failed',
    message: string,
  ): void {
    this.#recorder.append(investigationId, [
      {
        type: 'discovery.lead_unfollowed',
        producer: { kind: 'system', component: 'application.source-discovery' },
        causationId: candidate.leadEventId,
        data: {
          originalUrl: candidate.originalUrl,
          normalizedUrl: candidate.normalizedUrl,
          depth: candidate.depth,
          reason,
          message,
        },
      },
    ]);
  }

  #recordQueryFailure(
    investigationId: InvestigationId,
    query: string,
    code:
      | 'provider_failure'
      | 'timeout'
      | 'canceled'
      | 'invalid_output'
      | 'budget_exhausted',
    causationId: EventId,
  ): void {
    this.#recorder.append(investigationId, [
      {
        type: 'discovery.query_failed',
        producer: {
          kind: 'system',
          component: 'application.source-discovery',
        },
        causationId,
        data: {
          query,
          code,
          message: `Source discovery query failed with ${code}.`,
        },
      },
    ]);
  }
}

export function normalizeCandidateUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Candidate URL must use HTTP or HTTPS.');
  }
  url.hash = '';
  return url.toString();
}

function quoteQuery(claim: string): string {
  const bounded = claim
    .replace(/["\n\r]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_900);
  return `"${bounded}"`;
}

function operationId(
  investigationId: InvestigationId,
  stage: string,
  index: number,
): string {
  return `${investigationId}:${stage}:${index.toString()}`;
}
