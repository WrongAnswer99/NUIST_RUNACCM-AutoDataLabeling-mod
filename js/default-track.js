export async function tryLoadDefaultPoseTrack({
    fetchTrack = (path) => fetch(path),
    loadFramesFromText,
    fileName = 'track.txt'
} = {}) {
    if (typeof loadFramesFromText !== 'function') {
        throw new Error('loadFramesFromText is required');
    }

    try {
        const path = `./${fileName}`;
        const response = await fetchTrack(path);
        if (!response?.ok) return false;

        const text = await response.text();
        loadFramesFromText(fileName, text);
        return true;
    } catch {
        return false;
    }
}
