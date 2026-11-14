// AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
// LERC1 decoder (web/js/terrain/lerc1.js) against the uncompressed output of the same Moon Trek
// request (format=bsq): every valid value within maxZError, identical validity mask.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './physics_helpers.mjs';
import { decodeLerc1 } from '../js/terrain/lerc1.js';
import { decodeBsq } from '../js/terrain/trek.js';

const FIX = join(REPO, 'web', 'tests', 'fixtures');
const META = JSON.parse(readFileSync(join(FIX, 'trek_fixtures.json'), 'utf8'));
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

for (const c of META.cases) {
  test(`LERC1 decode matches bsq: ${c.name}`, () => {
    const L = decodeLerc1(ab(join(FIX, `trek_${c.name}.lerc`)));
    const B = decodeBsq(ab(join(FIX, `trek_${c.name}.bsq`)), c.n, c.n);
    assert.equal(L.width, c.n);
    assert.equal(L.height, c.n);
    assert.ok(Math.abs(L.maxZError - c.tol) < 1e-9, `maxZError ${L.maxZError}`);
    let nValid = 0, maxErr = 0;
    for (let i = 0; i < c.n * c.n; i++) {
      const vb = B.pixels[i], vl = L.pixels[i];
      assert.equal(Number.isNaN(vl), Number.isNaN(vb), `validity differs at ${i}`);
      if (Number.isNaN(vb)) continue;
      nValid++;
      maxErr = Math.max(maxErr, Math.abs(vl - vb));
    }
    assert.ok(nValid > 0);
    assert.ok(maxErr <= c.tol * 1.0001 + 1e-3, `max |lerc - bsq| = ${maxErr} m > ${c.tol}`);
    console.log(`# ${c.name}: ${nValid}/${c.n * c.n} valid, max |lerc - bsq| = ${maxErr.toFixed(4)} m (tolerance ${c.tol} m)`);
  });
}

test('LERC1 rejects other blobs', () => {
  assert.throws(() => decodeLerc1(new TextEncoder().encode('{"error":{"code":500}}').buffer), /CntZImage/);
});
