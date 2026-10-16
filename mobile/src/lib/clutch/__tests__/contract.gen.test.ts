/**
 * contract.gen.ts must be exactly what the generator makes of
 * clutch/openapi.json: a hand edit, or a pulled document that was not
 * regenerated, fails here.
 */
import { execFileSync } from 'child_process';
import { resolve } from 'path';

it('is regenerated from clutch/openapi.json', () => {
  const script = resolve(__dirname, '../../../../scripts/gen-clutch-contract.mjs');
  expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
});
