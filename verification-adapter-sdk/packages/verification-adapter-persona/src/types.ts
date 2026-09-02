export interface PersonaResource {
  id?: unknown;
  type?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

export interface PersonaResponse {
  data?: PersonaResource;
  meta?: Record<string, unknown>;
  included?: PersonaResource[];
}

export interface PersonaCaseTreeSnapshot {
  caseId: string;
  providerStatus: string;
  resolution: string | null;
  occurredAt: string;
  relatedResources: Array<{
    resourceType: 'inquiry' | 'transaction' | 'report' | 'verification';
    resourceId: string;
    providerStatus: string;
    subjectReference: string | null;
  }>;
  associatedPersonRequirements: Array<{
    subjectReference: string;
    inquiryId: string | null;
    requirementKind: 'associated_person' | 'ubo' | 'director' | 'officer' | 'authorized_representative';
    verificationMode: 'not_required' | 'database' | 'inquiry';
    normalizedStatus: 'not_required' | 'required' | 'pending' | 'processing' | 'manual_review_required' | 'verified' | 'declined' | 'failed' | 'expired' | 'canceled';
    mandatory: boolean;
    claimedOwnershipPercentage: number | null;
  }>;
  associatedPersonDiscoveryComplete: boolean;
}
