import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildZipBlobUrls,
    findObjectsJsonEntry,
    resolveZipBlobUrl
} from '../js/zip-import.js';

function createZipFile(payload) {
    return {
        dir: false,
        async: async () => payload
    };
}

test('findObjectsJsonEntry accepts nested and case-varied objects.json while ignoring macOS metadata', () => {
    const files = {
        'Scene/': { dir: true },
        'Scene/Objects.JSON': createZipFile('{"objects":[]}'),
        '__MACOSX/Scene/._Objects.JSON': createZipFile('metadata'),
        'Scene/.DS_Store': createZipFile('metadata')
    };

    const entry = findObjectsJsonEntry(files);

    assert.equal(entry.path, 'Scene/Objects.JSON');
    assert.equal(entry.sceneRoot, 'Scene');
    assert.equal(entry.file, files['Scene/Objects.JSON']);
});

test('buildZipBlobUrls indexes resources by root-relative and case-insensitive names', async () => {
    const files = {
        'Scene/Objects.JSON': createZipFile('{"objects":[]}'),
        'Scene/MAP.PNG': createZipFile('map-image'),
        'Scene/MODELS/Coin.GLB': createZipFile('coin-model'),
        '__MACOSX/Scene/._Coin.GLB': createZipFile('metadata'),
        'Scene/.DS_Store': createZipFile('metadata')
    };
    const objectsEntry = findObjectsJsonEntry(files);

    const blobUrls = await buildZipBlobUrls(files, {
        sceneRoot: objectsEntry.sceneRoot,
        createObjectURL: (blob) => `blob:${blob}`
    });

    assert.equal(resolveZipBlobUrl(blobUrls, 'map.png'), 'blob:map-image');
    assert.equal(resolveZipBlobUrl(blobUrls, 'models/coin.glb'), 'blob:coin-model');
    assert.equal(resolveZipBlobUrl(blobUrls, 'MODELS/Coin.GLB'), 'blob:coin-model');
    assert.equal(resolveZipBlobUrl(blobUrls, '__MACOSX/Scene/._Coin.GLB'), null);
});

test('findObjectsJsonEntry returns null when no usable objects.json exists', () => {
    const files = {
        '__MACOSX/Scene/._objects.json': createZipFile('metadata'),
        'Scene/map.png': createZipFile('map-image')
    };

    assert.equal(findObjectsJsonEntry(files), null);
});
