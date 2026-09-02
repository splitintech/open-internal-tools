import { createTsupConfig } from '../../tooling/tsup.ts';

export default createTsupConfig(
  { index: 'src/index.ts' },
  ['@splitin/verification-engine', 'pg'],
);
