/**
 * FontAtlas - Runtime glyph cache with deferred generation
 *
 * ARCHITECTURE:
 * 1. getGlyph(codePoint) → returns GlyphInfo immediately
 *    - If glyph cached: returns with cached=true, no work
 *    - If glyph NOT cached: returns with cached=false, queues generation
 *
 * 2. Generation is DEFERRED via batched Promise (auto-resolves via microtask)
 *    - Multiple getGlyph() calls batch into single Promise
 *    - When Promise resolves: WASM generates glyphs, updates textures
 *    - NO MANUAL PUMPING - Promise auto-resolves
 *
 * 3. prefabLatin(variantId, fontSize, fontBuffer) → SYNC
 *    - Generates all Latin chars (a-z, A-Z, 0-9) immediately
 *    - Blocks until complete
 *    - After return, getGlyph('a') etc return with no pending work
 *
 * USAGE:
 *   const atlas = new FontAtlas(msdf, textureFactory, onGlyphsReady);
 *
 *   // Async flow (normal):
 *   const info = atlas.getGlyph({ codePoint: 65, ... });
 *   // info.texture is the page, info.cached tells if ready
 *   // onGlyphsReady() called when batch completes
 *
 *   // Sync flow (debug/prefab):
 *   atlas.prefabLatin('regular', 32, fontBytes);
 *   // All Latin glyphs now ready, no async work needed
 */

import type { MSDFGenerator, VariationAxis } from '../lib/kitMSDF/kitMSDF.js';
import type { TextureFactory, GlyphRequest, GlyphInfo, GlyphMetrics, AtlasConfig, AtlasStatus, GlyphLocation } from './types.js';
import { DEFAULT_CONFIG, LATIN_CODEPOINTS } from './types.js';
import { VariantAtlas } from './variant-atlas.js';

interface PendingGlyph {
    codePoint: number;
    genSize: number;
    fontBuffer: Uint8Array;
    variationAxes?: VariationAxis[];
    variantId: string;
}

export class FontAtlas<T> {

    private msdf: MSDFGenerator;
    private textureFactory: TextureFactory<T>;
    private config: AtlasConfig;
    private atlases: Map<string, VariantAtlas<T>> = new Map();
    private onGlyphsReady: (() => void) | null;

    private pendingGlyphs: PendingGlyph[] = [];
    private batchPromise: Promise<void> | null = null;

    constructor(
        msdf: MSDFGenerator,
        textureFactory: TextureFactory<T>,
        onGlyphsReady?: () => void,
        config?: Partial<AtlasConfig>
    ) {
        this.msdf = msdf;
        this.textureFactory = textureFactory;
        this.onGlyphsReady = onGlyphsReady || null;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    getGlyph(request: GlyphRequest): GlyphInfo<T> {
        const genSize = this.selectGenSize(request.renderSize);
        const atlas = this.getOrCreateAtlas(request.variantId, genSize);

        // Check cache
        const location = atlas.getGlyph(request.codePoint);
        if (location) {
            return this.locationToInfo(location, genSize, true);
        }

        // Reserve slot in page (no pixels yet)
        const placeholder = atlas.reserveGlyph(request.codePoint);

        // Queue generation
        this.queueGeneration({
            codePoint: request.codePoint,
            genSize,
            fontBuffer: request.fontBuffer,
            variationAxes: request.variationAxes,
            variantId: request.variantId,
        });

        return this.locationToInfo(placeholder, genSize, false);
    }

    private queueGeneration(pending: PendingGlyph): void {
        this.pendingGlyphs.push(pending);

        // Create batch promise if not exists
        if (!this.batchPromise) {
            this.batchPromise = Promise.resolve().then(() => this.processBatch());
        }
    }

    private async processBatch(): Promise<void> {
        // Grab pending and reset
        const batch = this.pendingGlyphs;
        this.pendingGlyphs = [];
        this.batchPromise = null;

        if (batch.length === 0) return;

        // Generate all glyphs
        for (const pending of batch) {
            const atlas = this.getOrCreateAtlas(pending.variantId, pending.genSize);

            // Check if glyph exists in font BEFORE generating
            this.msdf.loadFont(pending.fontBuffer);
            if (!this.msdf.hasGlyph(pending.codePoint)) {
                // Glyph not in font - mark as missing
                atlas.markEmpty(pending.codePoint, true);
                continue;
            }

            const glyph = this.generateGlyph(
                pending.codePoint,
                pending.genSize,
                pending.fontBuffer,
                pending.variationAxes
            );

            if (glyph) {
                const rgbaPixels = this.floatToRGBA(glyph.pixels, glyph.metrics.width, glyph.metrics.height);
                const metrics: GlyphMetrics = {
                    width: glyph.metrics.width,
                    height: glyph.metrics.height,
                    advance: glyph.metrics.advance,
                    xOffset: glyph.metrics.planeBounds.l,
                    yOffset: glyph.metrics.planeBounds.b,
                    planeBounds: glyph.metrics.planeBounds,
                };
                atlas.fillGlyph(pending.codePoint, rgbaPixels, metrics);
            } else {
                // Generation failed but glyph exists - mark as empty (e.g., space)
                atlas.markEmpty(pending.codePoint, false);
            }
        }

        // Flush all dirty pages
        for (const atlas of this.atlases.values()) {
            atlas.flushDirtyPages();
        }

        // Notify
        this.onGlyphsReady?.();
    }

    /**
     * Synchronously generate all Latin characters (a-z, A-Z, 0-9)
     * Blocks until complete. After return, getGlyph() for these chars returns cached.
     */
    prefabLatin(variantId: string, fontSize: number, fontBuffer: Uint8Array, variationAxes?: VariationAxis[]): void {
        const genSize = this.selectGenSize(fontSize);
        const atlas = this.getOrCreateAtlas(variantId, genSize);

        for (const codePoint of LATIN_CODEPOINTS) {
            // Skip if already cached
            if (atlas.getGlyph(codePoint)) continue;

            // Check if glyph exists in font BEFORE generating
            if (!this.msdf.hasGlyph(codePoint)) {
                // Glyph not in font - reserve and mark as missing
                atlas.reserveGlyph(codePoint);
                atlas.markEmpty(codePoint, true);
                continue;
            }

            const glyph = this.generateGlyph(codePoint, genSize, fontBuffer, variationAxes);
            if (glyph) {
                const rgbaPixels = this.floatToRGBA(glyph.pixels, glyph.metrics.width, glyph.metrics.height);
                const metrics: GlyphMetrics = {
                    width: glyph.metrics.width,
                    height: glyph.metrics.height,
                    advance: glyph.metrics.advance,
                    xOffset: glyph.metrics.planeBounds.l,
                    yOffset: glyph.metrics.planeBounds.b,
                    planeBounds: glyph.metrics.planeBounds,
                };
                atlas.addGlyph(codePoint, rgbaPixels, metrics);
            } else {
                // Generation failed but glyph exists - mark as empty (e.g., space)
                atlas.reserveGlyph(codePoint);
                atlas.markEmpty(codePoint, false);
            }
        }

        // Flush immediately
        atlas.flushDirtyPages();
    }

    private generateGlyph(
        codePoint: number,
        fontSize: number,
        fontBuffer: Uint8Array,
        axes?: VariationAxis[]
    ) {
        this.msdf.loadFont(fontBuffer);

        if (axes && axes.length > 0) {
            this.msdf.setVariationAxes(axes);
            return this.msdf.generateMTSDFVar(codePoint, fontSize, this.config.pixelRange);
        } else {
            this.msdf.clearVariationAxes();
            return this.msdf.generateMTSDF(codePoint, fontSize, this.config.pixelRange);
        }
    }

    private floatToRGBA(pixels: Float32Array, width: number, height: number): Uint8Array {
        const channels = pixels.length / (width * height);
        const rgba = new Uint8Array(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            if (channels === 4) {
                rgba[i * 4 + 0] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 0] * 255)));
                rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 1] * 255)));
                rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 2] * 255)));
                rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(pixels[i * 4 + 3] * 255)));
            } else {
                rgba[i * 4 + 0] = Math.max(0, Math.min(255, Math.round(pixels[i * 3 + 0] * 255)));
                rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(pixels[i * 3 + 1] * 255)));
                rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(pixels[i * 3 + 2] * 255)));
                rgba[i * 4 + 3] = 255;
            }
        }

        return rgba;
    }

    private locationToInfo(location: GlyphLocation<T>, genSize: number, cached: boolean): GlyphInfo<T> {
        const { page, x, y, width, height, metrics, empty, missing } = location;

        return {
            texture: page.texture,
            uvs: {
                u0: x / page.width,
                v0: y / page.height,
                u1: (x + width) / page.width,
                v1: (y + height) / page.height,
            },
            metrics,
            genSize,
            cached,
            empty,
            missing,
        };
    }

    private selectGenSize(renderSize: number): number {
        const { genSizes, sizeThresholds } = this.config;

        for (let i = 0; i < sizeThresholds.length; i++) {
            if (renderSize <= sizeThresholds[i]) {
                return genSizes[i];
            }
        }
        return genSizes[genSizes.length - 1];
    }

    private getOrCreateAtlas(variantId: string, genSize: number): VariantAtlas<T> {
        const key = `${variantId}_${genSize}`;
        let atlas = this.atlases.get(key);

        if (!atlas) {
            atlas = new VariantAtlas(
                variantId,
                genSize,
                this.config.pageSize,
                this.config.maxMixedPages,
                this.textureFactory
            );
            this.atlases.set(key, atlas);
        }

        return atlas;
    }

    get hasPendingWork(): boolean {
        return this.pendingGlyphs.length > 0 || this.batchPromise !== null;
    }

    getStatus(): AtlasStatus {
        let pageCount = 0;
        let glyphCount = 0;
        let memoryBytes = 0;

        for (const atlas of this.atlases.values()) {
            pageCount += atlas.getPageCount();
            glyphCount += atlas.getGlyphCount();
            memoryBytes += atlas.getMemoryBytes();
        }

        return {
            atlasCount: this.atlases.size,
            pageCount,
            glyphCount,
            memoryBytes,
        };
    }

    dispose(): void {
        for (const atlas of this.atlases.values()) {
            atlas.destroy();
        }
        this.atlases.clear();
        this.pendingGlyphs = [];
        this.batchPromise = null;
    }
}
