import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stateSource = await readFile(new URL('../js/state.js', import.meta.url), 'utf8');

test('default export camera AR position uses 0.16m height', () => {
    assert.match(stateSource, /arToSceneVector3\(0\.8,\s*0\.16,\s*-0\.2\)/);
});
