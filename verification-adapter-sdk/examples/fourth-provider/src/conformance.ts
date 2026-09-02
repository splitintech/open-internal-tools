import { runAdapterConformance } from '@splitin/verification-adapter-sdk';

import { CUSTOM_PACKAGE, EmployeeCheckAdapter } from './index.ts';

async function main(): Promise<void> {
  const results = await runAdapterConformance(new EmployeeCheckAdapter(), {
    attemptId: 'att_fourth_conformance',
    subjectReference: 'sub_opaque_fourth',
    packageCode: CUSTOM_PACKAGE,
    countryCode: 'US',
    idempotencyKey: 'idem_fourth_conformance',
    configurationRevision: 'cfg_sandbox',
  });
  const failed = results.filter((result) => !result.passed);
  process.stdout.write(`${results.map((result) => `${result.passed ? 'pass' : 'fail'} ${result.name}`).join('\n')}\n`);
  if (failed.length) process.exit(1);
}

void main();
