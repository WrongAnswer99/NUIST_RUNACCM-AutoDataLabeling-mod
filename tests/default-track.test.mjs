import assert from 'node:assert/strict';
import test from 'node:test';

import { tryLoadDefaultPoseTrack } from '../js/default-track.js';

test('tryLoadDefaultPoseTrack loads project track.txt when available', async () => {
    const calls = [];

    const loaded = await tryLoadDefaultPoseTrack({
        fetchTrack: async (path) => ({
            ok: true,
            text: async () => `content from ${path}`
        }),
        loadFramesFromText: (fileName, text) => calls.push({ fileName, text })
    });

    assert.equal(loaded, true);
    assert.deepEqual(calls, [
        { fileName: 'track.txt', text: 'content from ./track.txt' }
    ]);
});

test('tryLoadDefaultPoseTrack leaves trajectory empty when track.txt is missing', async () => {
    let didLoad = false;

    const loaded = await tryLoadDefaultPoseTrack({
        fetchTrack: async () => ({ ok: false, status: 404 }),
        loadFramesFromText: () => {
            didLoad = true;
        }
    });

    assert.equal(loaded, false);
    assert.equal(didLoad, false);
});
