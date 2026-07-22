import test from 'node:test';
import assert from 'node:assert/strict';
import {
    filterEnabledDetections,
    formatDetectionPreviewBox
} from '../js/export-helpers.js';

test('filterEnabledDetections keeps only enabled categories', () => {
    assert.deepEqual(filterEnabledDetections([
        { categoryName: 'car' },
        { categoryName: 'road_arrow' },
        { categoryName: 'person' }
    ], new Set(['car', 'road_arrow'])), [
        { categoryName: 'car' },
        { categoryName: 'road_arrow' }
    ]);
});

test('formatDetectionPreviewBox preserves label bbox and color', () => {
    assert.deepEqual(formatDetectionPreviewBox({
        categoryName: 'car',
        bbox: [10, 20, 30, 40],
        color: '#ff0000'
    }), {
        label: 'car',
        bbox: [10, 20, 30, 40],
        color: '#ff0000'
    });
});
