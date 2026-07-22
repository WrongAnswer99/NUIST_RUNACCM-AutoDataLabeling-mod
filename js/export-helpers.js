export function sanitizeSampleName(name) {
    const sanitized = name
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return sanitized || 'sample_0001';
}

export function buildTrajectoryFrameSampleName(sampleName, frameIndex, totalFrames) {
    const safeSampleName = sanitizeSampleName(sampleName);
    const digits = Math.max(4, String(Math.max(1, totalFrames)).length);
    return `${safeSampleName}_${String(frameIndex + 1).padStart(digits, '0')}`;
}

export function buildTrajectoryManifest(sampleName, poseTrack, frameEntries) {
    return {
        sampleName: sanitizeSampleName(sampleName),
        sourceFileName: poseTrack.fileName || '',
        totalFrames: frameEntries.length,
        frames: frameEntries.map((entry) => ({
            index: entry.index,
            timestamp: entry.timestamp,
            sampleName: entry.sampleName,
            pose: {
                xMeters: entry.pose.xMeters,
                zMeters: entry.pose.zMeters,
                yawDeg: entry.pose.yawDeg
            },
            files: {
                rgb: `${entry.sampleName}_rgb.png`,
                semantic: `${entry.sampleName}_semantic_mask.png`,
                instance: `${entry.sampleName}_instance_mask.png`,
                labels: `${entry.sampleName}_labels.json`,
                camera: `${entry.sampleName}_camera.json`
            }
        }))
    };
}

export function createCocoAnnotation({
    id,
    imageId,
    categoryId,
    bbox,
    area,
    isCrowd = 0,
    extra = {}
}) {
    return {
        id,
        image_id: imageId,
        category_id: categoryId,
        bbox,
        area,
        iscrowd: isCrowd,
        ...extra
    };
}

export function createCocoImage({ id, fileName, width, height, frameIndex, timestamp }) {
    return {
        id,
        file_name: fileName,
        width,
        height,
        frame_index: frameIndex,
        timestamp
    };
}

export function createCocoCategory({ id, name, supercategory = 'object' }) {
    return {
        id,
        name,
        supercategory
    };
}

export function createConnectedComponentSummary({ id, pixels, minX, minY, maxX, maxY }) {
    return {
        id,
        pixelCount: pixels,
        bbox: {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        },
        area: pixels
    };
}

export function extractConnectedComponentsFromMask(mask, width, height, minPixelCount = 20, includePixelIndices = false) {
    const visited = new Uint8Array(mask.length);
    const components = [];
    let nextId = 1;

    const offsets = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
    ];

    for (let startY = 0; startY < height; startY++) {
        for (let startX = 0; startX < width; startX++) {
            const startIndex = (startY * width) + startX;
            if (!mask[startIndex] || visited[startIndex]) continue;

            const queue = [[startX, startY]];
            visited[startIndex] = 1;

            let pixels = 0;
            let minX = startX;
            let minY = startY;
            let maxX = startX;
            let maxY = startY;
            const pixelIndices = includePixelIndices ? [] : null;

            while (queue.length) {
                const [x, y] = queue.shift();
                const pixelIndex = (y * width) + x;
                pixels++;
                if (pixelIndices) pixelIndices.push(pixelIndex);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);

                for (const [dx, dy] of offsets) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const neighborIndex = (ny * width) + nx;
                    if (!mask[neighborIndex] || visited[neighborIndex]) continue;
                    visited[neighborIndex] = 1;
                    queue.push([nx, ny]);
                }
            }

            if (pixels >= minPixelCount) {
                const component = createConnectedComponentSummary({
                    id: nextId++,
                    pixels,
                    minX,
                    minY,
                    maxX,
                    maxY
                });
                if (pixelIndices) component.pixelIndices = pixelIndices;
                components.push(component);
            }
        }
    }

    return components;
}

export function clampBoundingBoxToImage(bbox, imageWidth, imageHeight) {
    const x = Math.max(0, Math.min(imageWidth, bbox.x));
    const y = Math.max(0, Math.min(imageHeight, bbox.y));
    const maxX = Math.max(0, Math.min(imageWidth, bbox.x + bbox.width));
    const maxY = Math.max(0, Math.min(imageHeight, bbox.y + bbox.height));
    const width = Math.max(0, maxX - x);
    const height = Math.max(0, maxY - y);

    return { x, y, width, height };
}

export function toCocoBboxArray(bbox) {
    return [
        Number(bbox.x.toFixed(4)),
        Number(bbox.y.toFixed(4)),
        Number(bbox.width.toFixed(4)),
        Number(bbox.height.toFixed(4))
    ];
}

export function isValidBoundingBox(bbox, minSize = 1) {
    return bbox.width >= minSize && bbox.height >= minSize;
}

export function extractBoundingBoxFromMask(mask, width, height) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let visiblePixelCount = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!mask[(y * width) + x]) continue;
            visiblePixelCount++;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (!visiblePixelCount) return null;

    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

export function extractBlueArrowMaskFromImageData(imageData) {
    const { data, width, height } = imageData;
    const mask = new Uint8Array(width * height);

    for (let i = 0; i < mask.length; i++) {
        const offset = i * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        mask[i] = (b > 150 && b > g + 40 && g > r + 20) ? 1 : 0;
    }

    return mask;
}

export function extractAlphaMaskFromImageData(imageData, alphaThreshold = 0) {
    const { data, width, height } = imageData;
    const mask = new Uint8Array(width * height);

    for (let i = 0; i < mask.length; i++) {
        mask[i] = data[(i * 4) + 3] > alphaThreshold ? 1 : 0;
    }

    return mask;
}

export function decodeColorIdFromImageDataPixel(data, pixelIndex) {
    const offset = pixelIndex * 4;
    return (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
}

export function colorDistanceSquared(a, b) {
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    return ((ar - br) ** 2) + ((ag - bg) ** 2) + ((ab - bb) ** 2);
}

export function collectVisibleComponentDetectionsFromColorImageData(
    imageData,
    components,
    getComponentColorId,
    minVisiblePixelCount = 1,
    colorTolerance = 0
) {
    const componentStats = new Map();
    const colorIdToComponent = new Map();
    const componentColors = [];

    components.forEach((component) => {
        const colorId = getComponentColorId(component);
        if (!colorId) return;
        colorIdToComponent.set(colorId, component);
        componentColors.push({ colorId, component });
    });

    const toleranceSquared = colorTolerance * colorTolerance;
    for (let i = 0; i < imageData.width * imageData.height; i++) {
        const colorId = decodeColorIdFromImageDataPixel(imageData.data, i);
        let component = colorIdToComponent.get(colorId);
        if (!component && colorTolerance > 0 && colorId !== 0) {
            let bestMatch = null;
            let bestDistance = Number.POSITIVE_INFINITY;
            componentColors.forEach((entry) => {
                const distance = colorDistanceSquared(colorId, entry.colorId);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMatch = entry.component;
                }
            });
            if (bestDistance <= toleranceSquared) component = bestMatch;
        }
        if (!component) continue;

        const x = i % imageData.width;
        const y = Math.floor(i / imageData.width);
        if (!componentStats.has(component.id)) {
            componentStats.set(component.id, {
                component,
                visiblePixelCount: 0,
                minX: x,
                minY: y,
                maxX: x,
                maxY: y
            });
        }

        const stats = componentStats.get(component.id);
        stats.visiblePixelCount++;
        stats.minX = Math.min(stats.minX, x);
        stats.minY = Math.min(stats.minY, y);
        stats.maxX = Math.max(stats.maxX, x);
        stats.maxY = Math.max(stats.maxY, y);
    }

    return [...componentStats.values()]
        .filter((stats) => stats.visiblePixelCount >= minVisiblePixelCount)
        .sort((a, b) => a.component.id - b.component.id)
        .map((stats) => ({
            componentId: stats.component.id,
            pixelCount: stats.component.pixelCount,
            visiblePixelCount: stats.visiblePixelCount,
            bbox: {
                x: stats.minX,
                y: stats.minY,
                width: stats.maxX - stats.minX + 1,
                height: stats.maxY - stats.minY + 1
            }
        }));
}

export function filterEnabledDetections(detections, enabledCategories) {
    return detections.filter((detection) => enabledCategories.has(detection.categoryName));
}

export function formatDetectionPreviewBox(detection) {
    return {
        label: detection.categoryName,
        bbox: detection.bbox,
        color: detection.color || '#00ffaa'
    };
}
