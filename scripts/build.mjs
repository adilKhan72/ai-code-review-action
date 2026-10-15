// Bundles the action into a single file so the repo can be used with `uses:` without `npm install`.
// CommonJS output avoids ESM interop issues with dependencies that still ship CJS.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  legalComments: 'external',
  logLevel: 'info',
});
