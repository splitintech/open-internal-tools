import { createTsupConfig } from '../../tooling/tsup.ts';

export default createTsupConfig(
  {
    index: 'src/index.ts',
    launcher: 'src/launcher/index.ts',
    status: 'src/status/index.ts',
    retry: 'src/retry/index.ts',
    appeal: 'src/appeal/index.ts',
    support: 'src/support/index.ts',
    operations: 'src/operations/index.ts',
  },
  [
    'react',
    'react-dom',
    '@stripe/stripe-js',
    'persona',
    'react-plaid-link',
    '@splitin/verification-adapter-sdk',
    '@splitin/verification-web',
  ],
);
