import { createTsupConfig } from '../../tooling/tsup.ts';

export default createTsupConfig(
  {
    index: 'src/index.ts',
    express: 'src/express.ts',
    hono: 'src/hono.ts',
    supabase: 'src/supabase.ts',
  },
  ['@splitin/verification-adapter-sdk', '@splitin/verification-engine', 'express', 'hono'],
);
