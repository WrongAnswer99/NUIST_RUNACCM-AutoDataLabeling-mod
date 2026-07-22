import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createCocoAnnotation,
    createCocoImage,
    createCocoCategory,
    createConnectedComponentSummary,
    extractConnectedComponentsFromMask,
    clampBoundingBoxToImage,
    toCocoBboxArray,
    isValidBoundingBox,
    extractBoundingBoxFromMask,
    extractBlueArrowMaskFromImageData,
    extractAlphaMaskFromImageData,
    collectVisibleComponentDetectionsFromColorImageData
} from '../js/export-helpers.js';

test('createCocoImage emits a COCO image entry', () => {
    assert.deepEqual(createCocoImage({
        id: 7,
        fileName: 'frame_0001_rgb.png',
        width: 640,
        height: 480,
        frameIndex: 0,
        timestamp: '2026-06-16T00:00:00Z'
    }), {
        id: 7,
        file_name: 'frame_0001_rgb.png',
        width: 640,
        height: 480,
        frame_index: 0,
        timestamp: '2026-06-16T00:00:00Z'
    });
});

test('createCocoAnnotation emits bbox annotations with COCO keys', () => {
    assert.deepEqual(createCocoAnnotation({
        id: 9,
        imageId: 7,
        categoryId: 3,
        bbox: [10, 20, 30, 40],
        area: 1200
    }), {
        id: 9,
        image_id: 7,
        category_id: 3,
        bbox: [10, 20, 30, 40],
        area: 1200,
        iscrowd: 0
    });
});

test('createConnectedComponentSummary computes a tight bbox and pixel area', () => {
    assert.deepEqual(createConnectedComponentSummary({
        id: 2,
        pixels: 27,
        minX: 5,
        minY: 8,
        maxX: 11,
        maxY: 13
    }), {
        id: 2,
        pixelCount: 27,
        bbox: {
            x: 5,
            y: 8,
            width: 7,
            height: 6
        },
        area: 27
    });
});

test('createCocoCategory emits a category entry', () => {
    assert.deepEqual(createCocoCategory({
        id: 1,
        name: 'road_arrow'
    }), {
        id: 1,
        name: 'road_arrow',
        supercategory: 'object'
    });
});

test('extractConnectedComponentsFromMask splits separate blobs and filters tiny noise', () => {
    const width = 10;
    const height = 6;
    const mask = new Uint8Array(width * height);

    const setPixel = (x, y) => {
        mask[(y * width) + x] = 1;
    };

    for (let y = 1; y <= 3; y++) {
        for (let x = 1; x <= 3; x++) {
            setPixel(x, y);
        }
    }

    for (let y = 1; y <= 4; y++) {
        for (let x = 6; x <= 8; x++) {
            setPixel(x, y);
        }
    }

    setPixel(0, 0);
    setPixel(9, 5);

    assert.deepEqual(
        extractConnectedComponentsFromMask(mask, width, height, 5),
        [
            {
                id: 1,
                pixelCount: 9,
                bbox: { x: 1, y: 1, width: 3, height: 3 },
                area: 9
            },
            {
                id: 2,
                pixelCount: 12,
                bbox: { x: 6, y: 1, width: 3, height: 4 },
                area: 12
            }
        ]
    );
});

test('clampBoundingBoxToImage trims boxes to image bounds', () => {
    assert.deepEqual(clampBoundingBoxToImage({
        x: -4,
        y: 6,
        width: 14,
        height: 10
    }, 10, 12), {
        x: 0,
        y: 6,
        width: 10,
        height: 6
    });
});

test('toCocoBboxArray rounds bbox values for export', () => {
    assert.deepEqual(toCocoBboxArray({
        x: 1.23456,
        y: 2.34567,
        width: 3.45678,
        height: 4.56789
    }), [1.2346, 2.3457, 3.4568, 4.5679]);
});

test('isValidBoundingBox filters zero-size boxes', () => {
    assert.equal(isValidBoundingBox({ width: 0, height: 4 }), false);
    assert.equal(isValidBoundingBox({ width: 4, height: 4 }), true);
});

test('extractBoundingBoxFromMask returns null when a target is fully occluded', () => {
    const width = 6;
    const height = 4;
    const mask = new Uint8Array(width * height);
    assert.equal(extractBoundingBoxFromMask(mask, width, height), null);
});

test('extractBoundingBoxFromMask derives bbox from visible pixels only', () => {
    const width = 6;
    const height = 5;
    const mask = new Uint8Array(width * height);

    const setPixel = (x, y) => {
        mask[(y * width) + x] = 1;
    };

    setPixel(2, 1);
    setPixel(3, 1);
    setPixel(2, 2);
    setPixel(3, 2);
    setPixel(2, 3);

    assert.deepEqual(extractBoundingBoxFromMask(mask, width, height), {
        x: 2,
        y: 1,
        width: 2,
        height: 3
    });
});

test('extractBlueArrowMaskFromImageData keeps blue arrow-like pixels only', () => {
    const width = 2;
    const height = 2;
    const data = new Uint8ClampedArray([
        30, 70, 180, 255,
        80, 80, 80, 255,
        40, 110, 175, 255,
        140, 150, 160, 255
    ]);

    assert.deepEqual(
        Array.from(extractBlueArrowMaskFromImageData({ data, width, height })),
        [1, 0, 1, 0]
    );
});

test('extractAlphaMaskFromImageData keeps only non-transparent map pixels', () => {
    const width = 3;
    const height = 1;
    const data = new Uint8ClampedArray([
        255, 0, 0, 0,
        0, 255, 0, 1,
        0, 0, 255, 255
    ]);

    assert.deepEqual(
        Array.from(extractAlphaMaskFromImageData({ data, width, height })),
        [0, 1, 1]
    );
});

test('collectVisibleComponentDetectionsFromColorImageData boxes only visible component pixels', () => {
    const width = 6;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    const setPixel = (x, y, [r, g, b]) => {
        const offset = ((y * width) + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = 255;
    };

    setPixel(1, 1, [0, 0, 1]);
    setPixel(2, 1, [0, 0, 1]);
    setPixel(2, 2, [0, 0, 1]);
    setPixel(4, 1, [0, 0, 3]);

    const components = [
        { id: 1, pixelCount: 100, bbox: { x: 0, y: 0, width: 3, height: 3 }, colorId: 1 },
        { id: 2, pixelCount: 120, bbox: { x: 3, y: 0, width: 2, height: 2 }, colorId: 2 },
        { id: 3, pixelCount: 80, bbox: { x: 4, y: 1, width: 1, height: 1 }, colorId: 3 }
    ];

    assert.deepEqual(
        collectVisibleComponentDetectionsFromColorImageData(
            { data, width, height },
            components,
            (component) => component.colorId,
            2
        ),
        [
            {
                componentId: 1,
                pixelCount: 100,
                visiblePixelCount: 3,
                bbox: { x: 1, y: 1, width: 2, height: 2 }
            }
        ]
    );
});

test('collectVisibleComponentDetectionsFromColorImageData can match slightly shifted component colors', () => {
    const width = 3;
    const height = 1;
    const data = new Uint8ClampedArray([
        235, 20, 20, 255,
        0, 0, 0, 255,
        0, 0, 0, 255
    ]);

    assert.deepEqual(
        collectVisibleComponentDetectionsFromColorImageData(
            { data, width, height },
            [{ id: 1, pixelCount: 50, colorId: 0xf01818 }],
            (component) => component.colorId,
            1,
            24
        ),
        [
            {
                componentId: 1,
                pixelCount: 50,
                visiblePixelCount: 1,
                bbox: { x: 0, y: 0, width: 1, height: 1 }
            }
        ]
    );
});

test('collectVisibleComponentDetectionsFromColorImageData assigns shifted colors to nearest component', () => {
    const width = 2;
    const height = 1;
    const data = new Uint8ClampedArray([
        90, 130, 50, 255,
        205, 52, 52, 255
    ]);

    const detections = collectVisibleComponentDetectionsFromColorImageData(
        { data, width, height },
        [
            { id: 1, pixelCount: 0, colorId: 0x588030 },
            { id: 2, pixelCount: 0, colorId: 0xd03030 }
        ],
        (component) => component.colorId,
        1,
        80
    );

    assert.deepEqual(detections.map((entry) => ({
        componentId: entry.componentId,
        bbox: entry.bbox
    })), [
        { componentId: 1, bbox: { x: 0, y: 0, width: 1, height: 1 } },
        { componentId: 2, bbox: { x: 1, y: 0, width: 1, height: 1 } }
    ]);
});
