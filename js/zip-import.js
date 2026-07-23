function getPathSegments(path) {
    return normalizeZipPath(path).split('/').filter(Boolean);
}

function getBaseName(path) {
    const segments = getPathSegments(path);
    return segments[segments.length - 1] || '';
}

function getDirName(path) {
    const segments = getPathSegments(path);
    return segments.slice(0, -1).join('/');
}

function stripSceneRoot(path, sceneRoot) {
    const normalizedPath = normalizeZipPath(path);
    const normalizedRoot = normalizeZipPath(sceneRoot);
    if (!normalizedRoot) return normalizedPath;

    const lowerPath = normalizedPath.toLowerCase();
    const lowerRoot = normalizedRoot.toLowerCase();
    if (lowerPath === lowerRoot) return '';
    if (!lowerPath.startsWith(`${lowerRoot}/`)) return normalizedPath;

    return normalizedPath.slice(normalizedRoot.length + 1);
}

function setUrlForKey(index, key, url) {
    const normalizedKey = normalizeZipPath(key);
    if (!normalizedKey) return;

    if (!Object.prototype.hasOwnProperty.call(index, normalizedKey)) {
        index[normalizedKey] = url;
    }

    const lowerKey = normalizedKey.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(index, lowerKey)) {
        index[lowerKey] = url;
    }
}

function registerResourceUrl(index, path, sceneRoot, url) {
    const normalizedPath = normalizeZipPath(path);
    const relativePath = stripSceneRoot(normalizedPath, sceneRoot);
    const baseName = getBaseName(normalizedPath);

    setUrlForKey(index, normalizedPath, url);
    setUrlForKey(index, relativePath, url);
    setUrlForKey(index, baseName, url);
}

export function normalizeZipPath(path = '') {
    return String(path)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
}

export function isMacMetadataPath(path) {
    return getPathSegments(path).some((segment) => {
        const lowerSegment = segment.toLowerCase();
        return lowerSegment === '__macosx'
            || lowerSegment === '.ds_store'
            || lowerSegment.startsWith('._');
    });
}

export function findObjectsJsonEntry(zipFiles = {}) {
    const candidates = Object.entries(zipFiles)
        .map(([path, file]) => ({
            path: normalizeZipPath(path),
            file
        }))
        .filter(({ path, file }) => (
            file
            && !file.dir
            && !isMacMetadataPath(path)
            && getBaseName(path).toLowerCase() === 'objects.json'
        ))
        .sort((a, b) => {
            const aIsRoot = a.path.toLowerCase() === 'objects.json' ? 0 : 1;
            const bIsRoot = b.path.toLowerCase() === 'objects.json' ? 0 : 1;
            if (aIsRoot !== bIsRoot) return aIsRoot - bIsRoot;

            const aDepth = getPathSegments(a.path).length;
            const bDepth = getPathSegments(b.path).length;
            if (aDepth !== bDepth) return aDepth - bDepth;

            return a.path.localeCompare(b.path);
        });

    const selected = candidates[0];
    if (!selected) return null;

    return {
        path: selected.path,
        sceneRoot: getDirName(selected.path),
        file: selected.file
    };
}

export async function buildZipBlobUrls(zipFiles = {}, {
    sceneRoot = '',
    createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL)
} = {}) {
    if (typeof createObjectURL !== 'function') {
        throw new Error('当前浏览器不支持 ZIP 资源 URL 创建。');
    }

    const zipBlobUrls = {};

    for (const [path, fileEntry] of Object.entries(zipFiles)) {
        const normalizedPath = normalizeZipPath(path);
        if (!fileEntry || fileEntry.dir || isMacMetadataPath(normalizedPath)) continue;

        const lowerBaseName = getBaseName(normalizedPath).toLowerCase();
        const isGlb = lowerBaseName.endsWith('.glb');
        const isMapImage = lowerBaseName.endsWith('.png') && lowerBaseName.includes('map');
        if (!isGlb && !isMapImage) continue;

        const blob = await fileEntry.async('blob');
        const url = createObjectURL(blob);
        registerResourceUrl(zipBlobUrls, normalizedPath, sceneRoot, url);
    }

    return zipBlobUrls;
}

export function resolveZipBlobUrl(zipBlobUrls, ...paths) {
    if (!zipBlobUrls) return null;

    for (const path of paths) {
        if (!path) continue;

        const normalizedPath = normalizeZipPath(path);
        const candidates = [
            normalizedPath,
            normalizedPath.toLowerCase(),
            getBaseName(normalizedPath),
            getBaseName(normalizedPath).toLowerCase()
        ];

        for (const candidate of candidates) {
            if (candidate && Object.prototype.hasOwnProperty.call(zipBlobUrls, candidate)) {
                return zipBlobUrls[candidate];
            }
        }
    }

    return null;
}
