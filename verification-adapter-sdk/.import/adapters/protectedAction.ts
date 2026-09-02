import { assertProtectedVerificationActionCode } from "./actionBoundary.ts";

/**
 * Provider-neutral gate for an Edge Function that is about to cause an
 * external effect. The database re-evaluates at claim time, so a stale browser
 * preflight or a copied authorization ID can never authorize the effect.
 */
export class ProtectedActionDeniedError extends Error {
  constructor(
    readonly reason: string,
    readonly actionCode: string,
    readonly resourceHash: string | null,
    readonly requirements: Array<{
      subjectSelector: string;
      packageCode: string;
      satisfied: boolean;
      reason: string;
    }> = [],
  ) {
    super(`VERIFICATION_ACTION_DENIED:${reason}`);
  }

  toSafeEnvelope() {
    return {
      contract: 'splitin.verification.required.v2',
      actionKey: this.actionCode,
      resourceHash: this.resourceHash,
      requiredPackages: [...new Set(this.requirements.filter((item) => !item.satisfied).map((item) => item.packageCode))],
      denialCode: normalizeDenialCode(this.reason),
      requirements: this.requirements,
      continuation: {
        resumable: true,
        returnRouteKey: 'verification.resume',
        automaticReplayAllowed: false,
      },
    };
  }
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

type IssuedAuthorization = {
  authorization_id: string | null;
  allowed: boolean;
  enforcement_active: boolean;
  denial_code: string;
  requirements: unknown;
  resource_hash: string | null;
};

function firstRow(value: unknown): IssuedAuthorization | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Record<string, unknown>;
  if (
    typeof row.allowed !== "boolean"
    || typeof row.enforcement_active !== "boolean"
    || typeof row.denial_code !== "string"
    || (row.authorization_id !== null && typeof row.authorization_id !== "string")
  ) return null;
  return row as IssuedAuthorization;
}

/**
 * Issue and immediately consume a maximum-five-minute authorization. Call this
 * only after the endpoint has independently verified normal ownership and
 * role/resource authorization. The resource ID must be server-derived.
 */
export async function requireExternalProtectedAction(
  client: RpcClient,
  input: {
    actorUserId: string;
    actionCode: string;
    resourceType: string;
    resourceId: string;
  },
): Promise<void> {
  assertProtectedVerificationActionCode(input.actionCode);
  const issued = await client.rpc("verification_issue_protected_action_authorization_v2", {
    p_actor_user_id: input.actorUserId,
    p_action_code: input.actionCode,
    p_resource_type: input.resourceType,
    p_resource_id: input.resourceId,
    p_ttl_seconds: 300,
  });
  if (issued.error) {
    throw new ProtectedActionDeniedError("provider_unavailable", input.actionCode, null);
  }
  const authorization = firstRow(issued.data);
  if (!authorization) {
    throw new ProtectedActionDeniedError("provider_unavailable", input.actionCode, null);
  }
  // Governance deliberately leaves enforcement inactive until both owners
  // approve a policy. The server contract remains in place before activation.
  if (!authorization.enforcement_active) return;
  if (!authorization.allowed || !authorization.authorization_id) {
    throw new ProtectedActionDeniedError(
      authorization.denial_code,
      input.actionCode,
      authorization.resource_hash,
      safeRequirements(authorization.requirements),
    );
  }

  const claimed = await client.rpc("verification_claim_protected_action_authorization", {
    p_authorization_id: authorization.authorization_id,
    p_actor_user_id: input.actorUserId,
    p_action_code: input.actionCode,
    p_resource_type: input.resourceType,
    p_resource_id: input.resourceId,
  });
  if (claimed.error || claimed.data !== true) {
    throw new ProtectedActionDeniedError("verification_required", input.actionCode, authorization.resource_hash, safeRequirements(authorization.requirements));
  }
}

export function verificationRequiredErrorResponse(error: ProtectedActionDeniedError) {
  const details = error.toSafeEnvelope();
  return {
    contractVersion: '2.0.0',
    error: {
      code: 'VERIFICATION_REQUIRED',
      safeErrorCode: 'VERIFICATION_REQUIRED',
      message: 'Verification is required before this action can continue.',
      details,
      retryAfter: null,
      supportPath: '/support/verification',
    },
    verificationRequired: details,
  };
}

function safeRequirements(value: unknown): ProtectedActionDeniedError['requirements'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.subjectSelector !== 'string' || typeof row.packageCode !== 'string'
      || typeof row.satisfied !== 'boolean' || typeof row.reason !== 'string') return [];
    return [{
      subjectSelector: row.subjectSelector,
      packageCode: row.packageCode,
      satisfied: row.satisfied,
      reason: normalizeDenialCode(row.reason),
    }];
  });
}

function normalizeDenialCode(value: string): string {
  return [
    'allowed', 'policy_not_active', 'authentication_required', 'unknown_action', 'action_paused',
    'ambiguous_subject', 'ambiguous_resource', 'role_or_resource_unauthorized', 'verification_required',
    'processing', 'manual_review', 'declined', 'expired', 'provider_unavailable',
    'ownership_required', 'business_kyb_required',
  ].includes(value) ? value : 'verification_required';
}
