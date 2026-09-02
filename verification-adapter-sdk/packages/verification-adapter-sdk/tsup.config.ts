import { createTsupConfig } from '../../tooling/tsup.ts';

export default createTsupConfig({
  index: 'src/index.ts',
  conformance: 'src/conformance.ts',
  fakes: 'src/fakes.ts',
});
