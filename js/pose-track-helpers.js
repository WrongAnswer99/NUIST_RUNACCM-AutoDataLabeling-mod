const DEFAULT_MIN_CHECKPOINTS_BEFORE_LAP = 3;
const DEFAULT_GATE_HALF_WIDTH_METERS = 0.75;
const DEFAULT_CHECKPOINT_HALF_WIDTH_METERS = 0.35;
const DEFAULT_CONTACT_DISTANCE_METERS = 0.08;
const DEFAULT_REARM_DISTANCE_METERS = 0.18;

function normalizeDegrees(degrees) {
    let value = degrees;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
}

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function getBaseName(path = '') {
    return String(path).replace(/\\/g, '/').split('/').pop() || '';
}

function distanceSquared(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return (dx * dx) + (dz * dz);
}

function makeLineAxes(lineAngleDeg = 0) {
    const radians = lineAngleDeg * Math.PI / 180;
    const tangent = {
        x: Math.cos(radians),
        z: Math.sin(radians)
    };

    return {
        tangent,
        normal: {
            x: -tangent.z,
            z: tangent.x
        }
    };
}

function signedDistanceToLine(point, marker) {
    const { normal } = makeLineAxes(marker.lineAngleDeg);
    return ((point.xMeters - marker.x) * normal.x) + ((point.zMeters - marker.z) * normal.z);
}

function projectionAlongLine(point, marker) {
    const { tangent } = makeLineAxes(marker.lineAngleDeg);
    return ((point.xMeters - marker.x) * tangent.x) + ((point.zMeters - marker.z) * tangent.z);
}

function pointTouchesMarker(point, marker, contactDistance = DEFAULT_CONTACT_DISTANCE_METERS) {
    return Math.abs(signedDistanceToLine(point, marker)) <= contactDistance
        && Math.abs(projectionAlongLine(point, marker)) <= marker.halfWidth;
}

function segmentCrossesMarker(start, end, marker, epsilon = 0.0001) {
    const d0 = signedDistanceToLine(start, marker);
    const d1 = signedDistanceToLine(end, marker);

    if (Math.abs(d0) <= epsilon && Math.abs(d1) <= epsilon) {
        return pointTouchesMarker(start, marker) || pointTouchesMarker(end, marker);
    }

    if (d0 > epsilon && d1 > epsilon) return false;
    if (d0 < -epsilon && d1 < -epsilon) return false;

    const denominator = d0 - d1;
    const t = Math.abs(denominator) <= epsilon ? 0 : d0 / denominator;
    const clampedT = Math.max(0, Math.min(1, t));
    const intersection = {
        xMeters: start.xMeters + ((end.xMeters - start.xMeters) * clampedT),
        zMeters: start.zMeters + ((end.zMeters - start.zMeters) * clampedT)
    };

    return Math.abs(projectionAlongLine(intersection, marker)) <= marker.halfWidth;
}

function createMarkerFromObject(obj, {
    id,
    lineAngleDeg,
    fallbackHalfWidth
}) {
    const scale = obj.scale || {};
    const scaleX = Math.abs(toFiniteNumber(scale.x, 0));
    const scaleZ = Math.abs(toFiniteNumber(scale.z, 0));

    return {
        id,
        x: toFiniteNumber(obj.position?.x),
        z: toFiniteNumber(obj.position?.z),
        lineAngleDeg: normalizeDegrees(lineAngleDeg),
        halfWidth: Math.max(fallbackHalfWidth, scaleX / 2, scaleZ / 2)
    };
}

function isBeginDoorObject(obj) {
    return getBaseName(obj?.name).toLowerCase() === 'begindoor.glb'
        || String(obj?.name || '').toLowerCase().includes('begindoor');
}

function isCheckpointObject(obj) {
    return String(obj?.type || '').toLowerCase() === 'checkpoint'
        || getBaseName(obj?.name).toLowerCase().includes('checkpoint');
}

function checkpointPhysicalKey(marker) {
    const roundedX = marker.x.toFixed(3);
    const roundedZ = marker.z.toFixed(3);
    const roundedAngle = normalizeDegrees(marker.lineAngleDeg).toFixed(1);
    return `${roundedX}:${roundedZ}:${roundedAngle}`;
}

function findNearestCheckpoint(beginDoor, checkpoints) {
    if (!checkpoints.length) return null;

    const doorPoint = { x: beginDoor.position?.x || 0, z: beginDoor.position?.z || 0 };
    return checkpoints
        .map((checkpoint) => ({
            checkpoint,
            distanceSquared: distanceSquared(
                doorPoint,
                { x: checkpoint.position?.x || 0, z: checkpoint.position?.z || 0 }
            )
        }))
        .sort((a, b) => a.distanceSquared - b.distanceSquared)[0]?.checkpoint || null;
}

export function extractLapCourseFromObjects(objects = []) {
    const beginDoor = objects.find(isBeginDoorObject);
    if (!beginDoor) return null;

    const checkpointObjects = objects.filter(isCheckpointObject);
    const nearestCheckpoint = findNearestCheckpoint(beginDoor, checkpointObjects);
    const doorLineAngleDeg = nearestCheckpoint
        ? toFiniteNumber(nearestCheckpoint.rotation?.y)
        : toFiniteNumber(beginDoor.rotation?.y) + 90;

    const checkpointMap = new Map();
    checkpointObjects.forEach((obj, index) => {
        const marker = createMarkerFromObject(obj, {
            id: String(obj.ID ?? obj.name ?? `checkpoint-${index}`),
            lineAngleDeg: toFiniteNumber(obj.rotation?.y),
            fallbackHalfWidth: DEFAULT_CHECKPOINT_HALF_WIDTH_METERS
        });
        const physicalKey = checkpointPhysicalKey(marker);
        if (!checkpointMap.has(physicalKey)) {
            checkpointMap.set(physicalKey, {
                ...marker,
                id: physicalKey
            });
        }
    });

    return {
        startGate: createMarkerFromObject(beginDoor, {
            id: String(beginDoor.ID ?? beginDoor.name ?? 'beginDoor'),
            lineAngleDeg: doorLineAngleDeg,
            fallbackHalfWidth: DEFAULT_GATE_HALF_WIDTH_METERS
        }),
        checkpoints: [...checkpointMap.values()]
    };
}

export function computeAngularLapsForFrames(frames) {
    if (!frames || frames.length === 0) return frames;

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    frames.forEach((frame) => {
        if (frame.xMeters < minX) minX = frame.xMeters;
        if (frame.xMeters > maxX) maxX = frame.xMeters;
        if (frame.zMeters < minZ) minZ = frame.zMeters;
        if (frame.zMeters > maxZ) maxZ = frame.zMeters;
    });

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    let totalAngle = 0;
    let lastAngle = Math.atan2(frames[0].zMeters - cz, frames[0].xMeters - cx);

    frames[0].lap = 0;

    for (let i = 1; i < frames.length; i++) {
        const frame = frames[i];
        const angle = Math.atan2(frame.zMeters - cz, frame.xMeters - cx);
        let diff = angle - lastAngle;

        if (diff > Math.PI) {
            diff -= 2 * Math.PI;
        } else if (diff < -Math.PI) {
            diff += 2 * Math.PI;
        }

        totalAngle += diff;
        lastAngle = angle;

        const lapFloat = Math.abs(totalAngle) / (2 * Math.PI);
        frame.lap = Math.floor(lapFloat);
    }

    return frames;
}

export function computeGateCheckpointLapsForFrames(frames, course, {
    minCheckpointsBeforeLap = DEFAULT_MIN_CHECKPOINTS_BEFORE_LAP
} = {}) {
    if (!frames || frames.length === 0) return frames;
    if (!course?.startGate || !course.checkpoints?.length) {
        return computeAngularLapsForFrames(frames);
    }

    let currentLap = 0;
    let hasPassedStartGate = false;
    let gateContactActive = pointTouchesMarker(
        frames[0],
        course.startGate,
        DEFAULT_REARM_DISTANCE_METERS
    );
    const crossedCheckpoints = new Set();
    frames[0].lap = currentLap;

    for (let i = 1; i < frames.length; i++) {
        const previousFrame = frames[i - 1];
        const frame = frames[i];
        const gateCrossed = !gateContactActive
            && segmentCrossesMarker(previousFrame, frame, course.startGate);

        if (gateCrossed) {
            if (!hasPassedStartGate) {
                currentLap += 1;
                hasPassedStartGate = true;
            } else if (crossedCheckpoints.size >= minCheckpointsBeforeLap) {
                currentLap += 1;
            }
            crossedCheckpoints.clear();
            gateContactActive = true;
        } else {
            course.checkpoints.forEach((checkpoint) => {
                if (!crossedCheckpoints.has(checkpoint.id)
                    && segmentCrossesMarker(previousFrame, frame, checkpoint)) {
                    crossedCheckpoints.add(checkpoint.id);
                }
            });
        }

        if (gateContactActive
            && !pointTouchesMarker(frame, course.startGate, DEFAULT_REARM_DISTANCE_METERS)) {
            gateContactActive = false;
        }

        frame.lap = currentLap;
    }

    return frames;
}

export function computeLapsForFrames(frames, course = null, options = {}) {
    if (course?.startGate) {
        return computeGateCheckpointLapsForFrames(frames, course, options);
    }

    return computeAngularLapsForFrames(frames);
}
