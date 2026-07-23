import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/main.css', import.meta.url), 'utf8');

function sectionForWorkflow(page) {
    const pattern = new RegExp(`<section[^>]+data-workflow-page="${page}"[\\s\\S]*?</section>`, 'i');
    return html.match(pattern)?.[0] || '';
}

function sectionsForWorkflow(page) {
    const pattern = new RegExp(`<section[^>]+data-workflow-page="${page}"[\\s\\S]*?</section>`, 'gi');
    return [...html.matchAll(pattern)].map((match) => match[0]);
}

test('workflow page bar omits the dedicated track page', () => {
    assert.equal(html.includes('class="app-topbar"'), false);
    assert.equal(html.includes('data-workflow-target="track"'), false);
    assert.equal(html.includes('data-workflow-page="track"'), false);
    assert.equal(html.includes('id="workflow-current-label"'), false);

    for (const page of ['resources', 'annotate', 'camera', 'export']) {
        assert.match(html, new RegExp(`data-workflow-target="${page}"`));
    }
});

test('trajectory import controls live in the resources page and timeline is persistent', () => {
    const resourcesSection = sectionForWorkflow('resources');

    assert.match(resourcesSection, /id="pose-track-file"/);
    assert.match(resourcesSection, /id="pose-track-import"/);
    assert.match(resourcesSection, /id="pose-track-clear"/);
    assert.match(resourcesSection, /id="pose-track-status"/);

    const timelineSection = html.match(/<section id="workflow-timeline"[\s\S]*?<\/section>/i)?.[0] || '';
    assert.doesNotMatch(timelineSection, /data-workflow-page=/);
    assert.doesNotMatch(css, /\.workflow-timeline\s*\{[\s\S]*?display:\s*none/i);
    assert.doesNotMatch(css, /\.workflow-timeline\.active/);
});

test('camera workflow uses compact grouped controls', () => {
    const cameraSection = sectionForWorkflow('camera');

    assert.match(cameraSection, /class="camera-tool-stack"/);
    assert.match(cameraSection, /class="camera-mode-group"/);
    assert.match(cameraSection, /class="camera-action-group"/);
    assert.match(cameraSection, /class="mode-description"/);
    assert.match(css, /\.camera-mode-group\s+\.segmented/);
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.camera-action-group\s+\.button-row/);
});

test('label editor is configured from the camera workflow', () => {
    const cameraSections = sectionsForWorkflow('camera').join('\n');
    const annotateSections = sectionsForWorkflow('annotate').join('\n');

    assert.match(cameraSections, /id="semantic-label-editor"/);
    assert.match(cameraSections, /id="instance-labels"/);
    assert.doesNotMatch(annotateSections, /id="semantic-label-editor"/);
    assert.doesNotMatch(annotateSections, /id="instance-labels"/);
});
