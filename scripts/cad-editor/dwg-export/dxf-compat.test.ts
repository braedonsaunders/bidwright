import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writerCompatibleDxf} from '../../../apps/cad-editor/packages/bidwright-cad-editor/public/dwg-export/dxf-compat.js';

test('DWG compatibility swaps model-space identities and every handle reference consistently',()=>{
 const input='0\nSECTION\n2\nHEADER\n9\n$HANDSEED\n5\n1\n0\nBLOCK_RECORD\n5\n18\n2\n*Model_Space\n0\nDICTIONARY\n5\n1F\n330\n0\n0\nLINE\n5\nA1\n330\n18\n360\n1F\n0\nEOF\n';
 const out=writerCompatibleDxf(input);
 assert.ok(out.includes('BLOCK_RECORD\n5\n1F\n'));
 assert.ok(out.includes('DICTIONARY\n5\n18\n'));
 assert.ok(out.includes('330\n1F\n360\n18\n'));
 assert.ok(out.includes('$HANDSEED\n5\nA2\n'));
});
test('redundant MTEXT rotation is removed only when the later direction takes precedence',()=>{
 const out=writerCompatibleDxf('0\nMTEXT\n50\n45\n11\n1\n21\n0\n31\n0\n1\nCafé · 90°\n0\nTEXT\n50\n45\n0\nEOF\n');
 assert.equal((out.match(/\n50\n/g)||[]).length,1);
 assert.ok(out.includes('Caf\\U+00E9 \\U+00B7 90\\U+00B0'));
 assert.ok(writerCompatibleDxf('0\nMTEXT\n50\n45\n0\nEOF\n').includes('\n50\n45\n'));
});
