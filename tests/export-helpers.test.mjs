import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeSampleName,
    buildTrajectoryFrameSampleName,
    buildTrajectoryManifest
} from '../js/export-helpers.js';

test('sanitizeSampleName normalizes invalid characters and falls back when empty', () => {
    assert.equal(sanitizeSampleName(' demo sample '), 'demo_sample');
    assert.equal(sanitizeSampleName('***'), 'sample_0001');
});

test('buildTrajectoryFrameSampleName uses stable zero-padded frame suffixes', () => {
    assert.equal(buildTrajectoryFrameSampleName('demo', 0, 12), 'demo_0001');
    assert.equal(buildTrajectoryFrameSampleName('demo', 11, 12), 'demo_0012');
    assert.equal(buildTrajectoryFrameSampleName('demo', 120, 135), 'demo_0121');
});

test('buildTrajectoryManifest emits archive entries for each exported frame', () => {
    const manifest = buildTrajectoryManifest(
        'demo sample',
        { fileName: 'track.txt' },
        [
            {
                index: 0,
                timestamp: '2026-06-14T10:00:00Z',
                sampleName: 'demo_sample_0001',
                pose: {
                    xMeters: 1.23,
                    zMeters: 4.56,
                    yawDeg: -90
                }
            }
        ]
    );

    assert.deepEqual(manifest, {
        sampleName: 'demo_sample',
        sourceFileName: 'track.txt',
        totalFrames: 1,
        frames: [
            {
                index: 0,
                timestamp: '2026-06-14T10:00:00Z',
                sampleName: 'demo_sample_0001',
                pose: {
                    xMeters: 1.23,
                    zMeters: 4.56,
                    yawDeg: -90
                },
                files: {
                    rgb: 'demo_sample_0001_rgb.png',
                    semantic: 'demo_sample_0001_semantic_mask.png',
                    instance: 'demo_sample_0001_instance_mask.png',
                    labels: 'demo_sample_0001_labels.json',
                    camera: 'demo_sample_0001_camera.json'
                }
            }
        ]
    });
});
