import type { ProtectedActionDenial, VerificationPackageCode } from '@splitin/verification-adapter-sdk';

const productionRoutesEnabled = false;

export interface ProtectedActionRequest {
  action: string;
  resourceHash: string;
  actorId: string;
  satisfiedPackages: VerificationPackageCode[];
  requiredPackages: VerificationPackageCode[];
}

export function evaluateProtectedAction(request: ProtectedActionRequest): ProtectedActionDenial | { allowed: true } {
  if (!productionRoutesEnabled && request.action.startsWith('production.')) {
    return denial(request, 'production_routes_disabled');
  }
  const missing = request.requiredPackages.filter((code) => !request.satisfiedPackages.includes(code));
  if (missing.length === 0) return { allowed: true };
  return denial(request, null, missing);
}

function denial(
  request: ProtectedActionRequest,
  supportPath: string | null,
  requiredPackages: VerificationPackageCode[] = request.requiredPackages,
): ProtectedActionDenial {
  const expiresAt = new Date(Date.parse('2026-01-01T00:05:00.000Z')).toISOString();
  return {
    code: 'VERIFICATION_REQUIRED',
    action: request.action,
    resourceHash: request.resourceHash,
    requiredPackages,
    continuation: {
      key: 'verification.resume',
      token: `cont_${request.resourceHash}`,
      expiresAt,
    },
    retryAfter: null,
    supportPath,
  };
}

async function main(): Promise<void> {
  const blocked = evaluateProtectedAction({
    action: 'payout.create',
    resourceHash: 'res_opaque_payout',
    actorId: 'actor_opaque',
    satisfiedPackages: [],
    requiredPackages: ['human_idv'],
  });
  const production = evaluateProtectedAction({
    action: 'production.payout.create',
    resourceHash: 'res_opaque_payout',
    actorId: 'actor_opaque',
    satisfiedPackages: ['human_idv'],
    requiredPackages: ['human_idv'],
  });
  process.stdout.write(`${JSON.stringify({ blocked, production })}\n`);
}

if (process.argv[1]?.includes('protected-action')) {
  void main();
}
