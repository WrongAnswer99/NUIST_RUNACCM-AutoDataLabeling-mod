import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeLapsForFrames,
    extractLapCourseFromObjects
} from '../js/pose-track-helpers.js';

function frame(xMeters, zMeters) {
    return { xMeters, zMeters, yawDeg: 0 };
}

function checkpoint(id, x, z, rotationY = 0) {
    return {
        ID: id,
        name: `Checkpoint_${id}`,
        type: 'checkpoint',
        position: { x, y: 0, z },
        rotation: { x: 0, y: rotationY, z: 0 },
        scale: { x: 1, y: 1, z: 0.2 }
    };
}

test('computeLapsForFrames increments on the first beginDoor crossing without checkpoint prerequisites', () => {
    const course = {
        startGate: { id: 'start', x: 0, z: 0, lineAngleDeg: 90, halfWidth: 2 },
        checkpoints: [
            { id: 'cp1', x: 1, z: 1, lineAngleDeg: 0, halfWidth: 2 },
            { id: 'cp2', x: 2, z: 2, lineAngleDeg: 90, halfWidth: 2 },
            { id: 'cp3', x: 1, z: 3, lineAngleDeg: 0, halfWidth: 2 }
        ]
    };
    const frames = [
        frame(-1, 0),
        frame(0.5, 0), // first beginDoor crossing increments immediately
        frame(1, 0.5),
        frame(1, 1.5), // checkpoint 1
        frame(1.5, 2),
        frame(2.5, 2), // checkpoint 2
        frame(0.5, 0),
        frame(-0.5, 0) // only 2 checkpoints since the previous beginDoor crossing
    ];

    computeLapsForFrames(frames, course);

    assert.deepEqual(frames.map((item) => item.lap), [0, 1, 1, 1, 1, 1, 1, 1]);
});

test('computeLapsForFrames increments again after three checkpoints and one later beginDoor crossing', () => {
    const course = {
        startGate: { id: 'start', x: 0, z: 0, lineAngleDeg: 90, halfWidth: 2 },
        checkpoints: [
            { id: 'cp1', x: 1, z: 1, lineAngleDeg: 0, halfWidth: 2 },
            { id: 'cp2', x: 2, z: 2, lineAngleDeg: 90, halfWidth: 2 },
            { id: 'cp3', x: 1, z: 3, lineAngleDeg: 0, halfWidth: 2 }
        ]
    };
    const frames = [
        frame(-1, 0),
        frame(0.5, 0), // first beginDoor crossing increments immediately
        frame(1, 0.5),
        frame(1, 1.5), // checkpoint 1
        frame(1.5, 2),
        frame(2.5, 2), // checkpoint 2
        frame(1, 2.5),
        frame(1, 3.5), // checkpoint 3
        frame(0.5, 0),
        frame(0.02, 0),
        frame(-0.02, 0),
        frame(-0.04, 0),
        frame(-0.5, 0)
    ];

    computeLapsForFrames(frames, course);

    assert.equal(frames[9].lap, 1);
    assert.equal(frames[10].lap, 2);
    assert.equal(frames[11].lap, 2);
    assert.equal(frames[12].lap, 2);
});

test('extractLapCourseFromObjects deduplicates overlapping checkpoint objects by physical position', () => {
    const course = extractLapCourseFromObjects([
        {
            ID: 5048,
            name: 'beginDoor.glb',
            type: 'static',
            position: { x: 0.73, y: 0.2, z: 1.44 },
            rotation: { x: 0, y: 92, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        },
        checkpoint(9000, 0.76, 1.42, 0),
        checkpoint(9006, 0.76, 1.42, 0),
        checkpoint(9001, 0.7, 3.32, 0)
    ]);

    assert.equal(course.startGate.x, 0.73);
    assert.equal(course.startGate.lineAngleDeg, 0);
    assert.equal(course.checkpoints.length, 2);
});

test('computeLapsForFrames falls back to angular lap detection without a beginDoor course', () => {
    const frames = [
        frame(1, 0),
        frame(0, 1),
        frame(-1, 0),
        frame(0, -1),
        frame(1, 0)
    ];

    computeLapsForFrames(frames, null);

    assert.deepEqual(frames.map((item) => item.lap), [0, 0, 0, 0, 1]);
});
