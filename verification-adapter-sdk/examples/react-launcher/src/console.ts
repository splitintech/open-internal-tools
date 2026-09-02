import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';
import type { ProviderLaunchEnvelope } from '@splitin/verification-adapter-sdk';

export interface LauncherProps {
  launcherKey: string;
  presentation: ProviderLaunchEnvelope['presentation'];
  attemptId: string;
  providerDisclosure?: string;
  productionRoutesEnabled: false;
}

export interface OperationsConsoleRow {
  attemptId: string;
  canonicalStatus: string;
  provider: string;
  safeErrorCode?: string | null;
}

export function toLauncherProps(launch: ProviderLaunchEnvelope): LauncherProps {
  return {
    launcherKey: launch.launcherKey,
    presentation: launch.presentation,
    attemptId: launch.attemptId,
    providerDisclosure: launch.providerDisclosure,
    productionRoutesEnabled: false,
  };
}

export function toOperationsRow(input: {
  attemptId: string;
  canonicalStatus: string;
  provider: string;
}): OperationsConsoleRow {
  return {
    attemptId: input.attemptId,
    canonicalStatus: input.canonicalStatus,
    provider: input.provider,
    safeErrorCode: null,
  };
}

export async function demoConsole(): Promise<{ launcher: LauncherProps; row: OperationsConsoleRow }> {
  const adapter = createFakeAdapterForScenario('input_required');
  const created = await adapter.createAttempt({
    attemptId: 'att_react_demo',
    subjectReference: 'sub_opaque_react',
    packageCode: 'human_idv',
    countryCode: 'US',
    idempotencyKey: 'idem_react_demo',
    configurationRevision: 'cfg_sandbox',
  });
  return {
    launcher: toLauncherProps(created.launch),
    row: toOperationsRow({
      attemptId: created.attemptId,
      canonicalStatus: created.canonicalStatus,
      provider: adapter.provider,
    }),
  };
}

async function main(): Promise<void> {
  const demo = await demoConsole();
  process.stdout.write(`${JSON.stringify({
    launcherKey: demo.launcher.launcherKey,
    productionRoutesEnabled: demo.launcher.productionRoutesEnabled,
    status: demo.row.canonicalStatus,
  })}\n`);
}

if (process.argv[1]?.includes('react-launcher')) {
  void main();
}
