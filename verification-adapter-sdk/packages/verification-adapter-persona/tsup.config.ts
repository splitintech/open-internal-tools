import { createTsupConfig } from '../../tooling/tsup.ts';

export default createTsupConfig(
  { index: 'src/index.ts', browser: 'src/browser.ts' },
  ['@splitin/verification-adapter-sdk', 'persona'],
);
