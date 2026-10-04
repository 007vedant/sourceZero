/**
 * Declares renderer-neutral investigation workspace and list presentation models.
 */

export type WorkspaceSection =
  | 'overview'
  | 'progress'
  | 'graph'
  | 'timeline'
  | 'evidence'
  | 'limitations'
  | 'trace';

export interface InvestigationAction {
  readonly type:
    | 'inspect_section'
    | 'edit_claim'
    | 'confirm_claim'
    | 'start_run'
    | 'restart_framing'
    | 'branch_investigation';
  readonly section?: WorkspaceSection;
}

export type OriginalInputView =
  | { readonly kind: 'claim'; readonly claim: string }
  | { readonly kind: 'url'; readonly url: string }
  | {
      readonly kind: 'claim_and_url';
      readonly claim: string;
      readonly url: string;
    };

export interface OverviewView<Status extends string = string> {
  readonly status: Status;
  readonly originalInput: OriginalInputView;
  readonly sourceCount: number;
  readonly relationshipCount: number;
}

export interface ProgressView<Status extends string = string> {
  readonly status: Status;
  readonly stage:
    'framing' | 'ready' | 'investigating' | 'finished' | 'stopped';
}

export interface FramingView {
  readonly proposals: readonly {
    readonly claimId: string;
    readonly wording: string;
    readonly origin: 'manual_normalization' | 'page_extraction' | 'user_edit';
  }[];
  readonly workingClaim?: {
    readonly claimId: string;
    readonly wording: string;
  };
  readonly confirmedClaim?: {
    readonly claimId: string;
    readonly wording: string;
  };
  readonly pageContext?: {
    readonly requestedUrl: string;
    readonly resolvedUrl: string;
    readonly title?: string;
    readonly fetchedArtifactId: string;
    readonly readableTextArtifactId: string;
    readonly readableCharacterCount: number;
  };
  readonly failure?: {
    readonly code: string;
    readonly stage: 'fetch' | 'extraction' | 'proposal';
    readonly message: string;
  };
}

export interface BudgetView {
  readonly configured: boolean;
  readonly limits: Readonly<Record<string, number>>;
  readonly usage: Readonly<Record<string, number>>;
}

export interface GraphElementDetailView {
  readonly summary: string;
  readonly evidence: readonly {
    readonly id: string;
    readonly excerpt: string;
  }[];
}

export interface ProvenanceGraphView {
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: 'claim' | 'source' | 'evidence';
    readonly label: string;
    readonly duplicateGroupId?: string;
    readonly detail?: GraphElementDetailView;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly sourceId: string;
    readonly targetId: string;
    readonly type: string;
    readonly detail?: GraphElementDetailView;
  }[];
}

export interface MutationTimelineView {
  readonly entries: readonly {
    readonly id: string;
    readonly occurredAt: string;
    readonly wording: string;
  }[];
}

export interface EvidenceTableView {
  readonly rows: readonly {
    readonly id: string;
    readonly sourceId: string;
    readonly excerpt: string;
  }[];
}

export interface LimitationsView {
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly message: string;
  }[];
}

export interface TraceView {
  readonly entries: readonly {
    readonly eventId: string;
    readonly sequence: number;
    readonly type: string;
    readonly occurredAt: string;
    readonly producerKind: 'user' | 'system' | 'model' | 'tool';
  }[];
}

export interface InvestigationWorkspaceView<
  InvestigationIdentifier extends string = string,
  Status extends string = string,
> {
  readonly investigationId: InvestigationIdentifier;
  readonly overview: OverviewView<Status>;
  readonly progress: ProgressView<Status>;
  readonly framing: FramingView;
  readonly budget: BudgetView;
  readonly graph: ProvenanceGraphView;
  readonly timeline: MutationTimelineView;
  readonly evidence: EvidenceTableView;
  readonly limitations: LimitationsView;
  readonly trace: TraceView;
  readonly availableActions: readonly InvestigationAction[];
}

export interface InvestigationListItemView<
  InvestigationIdentifier extends string = string,
  Status extends string = string,
> {
  readonly investigationId: InvestigationIdentifier;
  readonly status: Status;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSequence: number;
}
