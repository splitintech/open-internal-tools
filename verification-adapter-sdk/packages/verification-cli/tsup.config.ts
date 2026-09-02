import { createTsupConfig } from '../../tooling/tsup.ts';

export default {
  ...createTsupConfig({ cli: 'src/cli.ts' }, ['@splitin/verification-adapter-sdk']),
  banner: { js: '#!/usr/bin/env node' },
};
