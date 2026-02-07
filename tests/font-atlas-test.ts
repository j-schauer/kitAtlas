/**
 * kitAtlas Integration Tests - Real WASM, Real Textures
 *
 * Tests actual behavior:
 * 1. getGlyph() returns immediately with cached=false for new glyphs
 * 2. Deferred batch promise generates glyphs and calls onGlyphsReady
 * 3. After batch completes, getGlyph() returns cached=true
 * 4. prefabLatin() generates all Latin chars synchronously
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
}

async function runTest(name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (e: any) {
        console.log(`  FAIL: ${name}`);
        console.log(`        ${e.message}`);
        failed++;
    }
}

// Real texture factory - stores actual pixel buffers
interface RealTexture {
    id: number;
    width: number;
    height: number;
    buffer: Uint8Array;
    updates: number;
}

let textureId = 0;
const realTextureFactory = {
    create(width: number, height: number, buffer: Uint8Array): RealTexture {
        return {
            id: ++textureId,
            width,
            height,
            buffer: new Uint8Array(buffer),
            updates: 0,
        };
    },
    update(texture: RealTexture, buffer: Uint8Array): void {
        texture.buffer = new Uint8Array(buffer);
        texture.updates++;
    },
    destroy(texture: RealTexture): void {
        // no-op
    }
};

async function main() {
    console.log('kitAtlas Integration Tests\\n');

    // Load kitAtlas module
    const { FontAtlas, LATIN_CODEPOINTS } = await import(path.join(__dirname, 'kitAtlas.js'));

    // Load kitMSDF
    const { MSDFGenerator } = await import(path.join(__dirname, 'kitMSDF.js'));
    const MSdfCoreFactory = (await import(path.join(__dirname, 'msdf-core.js'))).default;

    // Load font
    const fontPath = path.join(__dirname, 'assets/Poppins-Regular.ttf');
    const fontBytes = new Uint8Array(fs.readFileSync(fontPath));

    // Init MSDF
    const msdf = await MSDFGenerator.init(MSdfCoreFactory);

    // ==================== DEFERRED GENERATION TESTS ====================
    console.log('Deferred Generation Tests:');

    await runTest('getGlyph returns immediately with cached=false', async () => {
        let callbackCalled: boolean = false;
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {
            callbackCalled = true;
        });

        const info = atlas.getGlyph({
            codePoint: 65, // 'A'
            variantId: 'test1',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        assert(info !== null, 'info should not be null');
        assert(!info.cached, 'first call should have cached=false');
        assert(info.texture !== null, 'texture should not be null');
        assert(!callbackCalled, 'callback should not be called yet');

        atlas.dispose();
    });

    await runTest('batch promise generates glyph and calls callback', async () => {
        let callbackCalled: boolean = false;
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {
            callbackCalled = true;
        });

        atlas.getGlyph({
            codePoint: 66, // 'B'
            variantId: 'test2',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        await new Promise(resolve => setTimeout(resolve, 100));
        assert(callbackCalled, 'callback should be called after batch');

        atlas.dispose();
    });

    await runTest('after batch completes, getGlyph returns cached=true', async () => {
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {});

        atlas.getGlyph({
            codePoint: 67, // 'C'
            variantId: 'test3',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        const info = atlas.getGlyph({
            codePoint: 67,
            variantId: 'test3',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        assert(info.cached, 'second call should have cached=true');
        assert(info.metrics.width > 0, 'metrics.width should be > 0');

        atlas.dispose();
    });

    await runTest('multiple getGlyph calls batch into single callback', async () => {
        let callbackCount = 0;
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {
            callbackCount++;
        });

        for (let i = 0; i < 5; i++) {
            atlas.getGlyph({
                codePoint: 68 + i,
                variantId: 'test4',
                fontBuffer: fontBytes,
                renderSize: 32,
            });
        }

        await new Promise(resolve => setTimeout(resolve, 200));
        assert(callbackCount === 1, `callback should be called once, got ${callbackCount}`);

        const status = atlas.getStatus();
        assert(status.glyphCount === 5, `should have 5 glyphs, got ${status.glyphCount}`);

        atlas.dispose();
    });

    // ==================== PREFAB TESTS ====================
    console.log('\\nPrefab Tests:');

    await runTest('prefabLatin generates all 62 Latin chars synchronously', async () => {
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {});

        const startTime = Date.now();
        atlas.prefabLatin('prefab1', 32, fontBytes);
        const elapsed = Date.now() - startTime;
        console.log(`        (prefabLatin took ${elapsed}ms)`);

        for (const cp of LATIN_CODEPOINTS) {
            const info = atlas.getGlyph({
                codePoint: cp,
                variantId: 'prefab1',
                fontBuffer: fontBytes,
                renderSize: 32,
            });
            assert(info.cached, `char ${cp} should be cached`);
        }

        const status = atlas.getStatus();
        assert(status.glyphCount === 62, `should have 62 glyphs, got ${status.glyphCount}`);

        atlas.dispose();
    });

    await runTest('after prefabLatin, getGlyph returns with no pending work', async () => {
        let callbackCount = 0;
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {
            callbackCount++;
        });

        atlas.prefabLatin('prefab2', 32, fontBytes);

        const info = atlas.getGlyph({
            codePoint: 97, // 'a'
            variantId: 'prefab2',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        assert(info.cached, 'should be cached after prefab');
        assert(!atlas.hasPendingWork, 'should have no pending work');

        await new Promise(resolve => setTimeout(resolve, 50));
        assert(callbackCount === 0, 'callback should not be called for prefabbed glyphs');

        atlas.dispose();
    });

    // ==================== TEXTURE DATA TESTS ====================
    console.log('\\nTexture Data Tests:');

    await runTest('texture contains actual pixel data after generation', async () => {
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {});

        atlas.prefabLatin('textest', 64, fontBytes);

        const info = atlas.getGlyph({
            codePoint: 65,
            variantId: 'textest',
            fontBuffer: fontBytes,
            renderSize: 64,
        });

        const texture = info.texture as RealTexture;
        assert(texture.buffer.length > 0, 'texture buffer should have data');
        assert(texture.updates > 0, 'texture should have been updated');

        let nonZeroPixels = 0;
        for (let i = 0; i < texture.buffer.length; i++) {
            if (texture.buffer[i] > 0) nonZeroPixels++;
        }
        assert(nonZeroPixels > 0, 'texture should have non-zero pixel data');

        atlas.dispose();
    });

    await runTest('UVs are valid after generation', async () => {
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {});

        atlas.prefabLatin('uvtest', 32, fontBytes);

        const info = atlas.getGlyph({
            codePoint: 88,
            variantId: 'uvtest',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        assert(info.uvs.u0 >= 0 && info.uvs.u0 <= 1, 'u0 should be in [0,1]');
        assert(info.uvs.v0 >= 0 && info.uvs.v0 <= 1, 'v0 should be in [0,1]');
        assert(info.uvs.u1 >= 0 && info.uvs.u1 <= 1, 'u1 should be in [0,1]');
        assert(info.uvs.v1 >= 0 && info.uvs.v1 <= 1, 'v1 should be in [0,1]');
        assert(info.uvs.u1 > info.uvs.u0, 'u1 should be > u0');
        assert(info.uvs.v1 > info.uvs.v0, 'v1 should be > v0');

        atlas.dispose();
    });

    // ==================== EMPTY/MISSING GLYPH TESTS ====================
    console.log('\\nEmpty/Missing Glyph Tests:');

    await runTest('missing glyph returns empty=true, missing=true', async () => {
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {});

        atlas.getGlyph({
            codePoint: 0x1F600,
            variantId: 'missing-test',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        const info = atlas.getGlyph({
            codePoint: 0x1F600,
            variantId: 'missing-test',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        assert(info.cached, 'should be cached after batch');
        assert(info.empty === true, 'missing glyph should be empty');
        assert(info.missing === true, 'missing glyph should have missing=true');

        atlas.dispose();
    });

    await runTest('existing glyph returns empty=false, missing=false', async () => {
        const atlas = new FontAtlas(msdf, realTextureFactory, () => {});

        atlas.prefabLatin('exists-test', 32, fontBytes);

        const info = atlas.getGlyph({
            codePoint: 65,
            variantId: 'exists-test',
            fontBuffer: fontBytes,
            renderSize: 32,
        });

        assert(info.cached, 'should be cached after prefab');
        assert(info.empty === false, 'existing glyph should not be empty');
        assert(info.missing === false, 'existing glyph should not be missing');
        assert(info.metrics.width > 0, 'should have width');

        atlas.dispose();
    });

    // Summary
    console.log('\\n=== Summary ===');
    console.log(`Tests: ${passed} passed, ${failed} failed`);

    if (failed > 0) process.exit(1);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
