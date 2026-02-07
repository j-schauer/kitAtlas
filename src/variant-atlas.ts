import type { TextureFactory, GlyphMetrics, GlyphLocation } from './types.js';
import { isLatinChar } from './types.js';
import { Page } from './page.js';

// Placeholder metrics for reserved but not-yet-generated glyphs
const PLACEHOLDER_METRICS: GlyphMetrics = {
    width: 0,
    height: 0,
    advance: 0,
    xOffset: 0,
    yOffset: 0,
    planeBounds: { l: 0, b: 0, r: 0, t: 0 },
};

export class VariantAtlas<T> {

    readonly variantId: string;
    readonly genSize: number;

    private latinPage: Page<T> | null = null;
    private mixedPages: Page<T>[] = [];
    private glyphIndex: Map<number, GlyphLocation<T>> = new Map();
    private pendingGlyphs: Set<number> = new Set();
    private lastAccessed: number = Date.now();

    private pageSize: number;
    private maxMixedPages: number;
    private textureFactory: TextureFactory<T>;

    constructor(
        variantId: string,
        genSize: number,
        pageSize: number,
        maxMixedPages: number,
        textureFactory: TextureFactory<T>
    ) {
        this.variantId = variantId;
        this.genSize = genSize;
        this.pageSize = pageSize;
        this.maxMixedPages = maxMixedPages;
        this.textureFactory = textureFactory;
    }

    // Get cached glyph if exists and is ready (not pending)
    getGlyph(codePoint: number): GlyphLocation<T> | null {
        this.lastAccessed = Date.now();
        if (this.pendingGlyphs.has(codePoint)) {
            return null; // Still pending generation
        }
        return this.glyphIndex.get(codePoint) || null;
    }

    // Reserve a slot for a glyph that will be generated later
    // Returns location with page reference but placeholder metrics
    reserveGlyph(codePoint: number): GlyphLocation<T> {
        this.lastAccessed = Date.now();

        const isLatin = isLatinChar(codePoint);
        const page = this.getOrCreatePage(isLatin, this.genSize); // Use genSize as estimate

        // Mark as pending
        this.pendingGlyphs.add(codePoint);

        // Return placeholder location - will be updated by fillGlyph()
        const location: GlyphLocation<T> = {
            page: { texture: page.texture, width: page.width, height: page.height },
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            metrics: PLACEHOLDER_METRICS,
            empty: false,
            missing: false,
        };

        this.glyphIndex.set(codePoint, location);
        return location;
    }

    // Fill in a previously reserved glyph with actual pixel data
    fillGlyph(codePoint: number, pixels: Uint8Array, metrics: GlyphMetrics): void {
        this.lastAccessed = Date.now();

        const isLatin = isLatinChar(codePoint);
        const page = this.getOrCreatePage(isLatin, metrics.height);

        const pos = page.tryAdd(pixels, metrics.width, metrics.height);
        if (!pos) {
            if (isLatin) {
                throw new Error(`Latin page full - this shouldn't happen`);
            }
            const newPage = this.createMixedPage();
            const newPos = newPage.tryAdd(pixels, metrics.width, metrics.height);
            if (!newPos) {
                throw new Error(`Fresh page can't fit glyph ${metrics.width}x${metrics.height}`);
            }
            this.updateGlyphLocation(codePoint, newPage, newPos, metrics);
            return;
        }

        this.updateGlyphLocation(codePoint, page, pos, metrics);
    }

    // Add a glyph immediately (for sync prefab)
    addGlyph(codePoint: number, pixels: Uint8Array, metrics: GlyphMetrics): GlyphLocation<T> {
        this.lastAccessed = Date.now();

        const isLatin = isLatinChar(codePoint);
        const page = this.getOrCreatePage(isLatin, metrics.height);

        const pos = page.tryAdd(pixels, metrics.width, metrics.height);
        if (!pos) {
            if (isLatin) {
                throw new Error(`Latin page full - this shouldn't happen`);
            }
            const newPage = this.createMixedPage();
            const newPos = newPage.tryAdd(pixels, metrics.width, metrics.height);
            if (!newPos) {
                throw new Error(`Fresh page can't fit glyph ${metrics.width}x${metrics.height}`);
            }
            return this.storeGlyph(codePoint, newPage, newPos, metrics);
        }

        return this.storeGlyph(codePoint, page, pos, metrics);
    }

    // Mark a reserved glyph as empty/missing (no texture data)
    markEmpty(codePoint: number, missing: boolean): void {
        const location = this.glyphIndex.get(codePoint);
        if (location) {
            location.empty = true;
            location.missing = missing;
            location.width = 0;
            location.height = 0;
        }
        this.pendingGlyphs.delete(codePoint);
    }

    private updateGlyphLocation(
        codePoint: number,
        page: Page<T>,
        pos: { x: number; y: number },
        metrics: GlyphMetrics
    ): void {
        const location = this.glyphIndex.get(codePoint);
        if (location) {
            location.page = { texture: page.texture, width: page.width, height: page.height };
            location.x = pos.x;
            location.y = pos.y;
            location.width = metrics.width;
            location.height = metrics.height;
            location.metrics = metrics;
            location.empty = false;
            location.missing = false;
        }
        this.pendingGlyphs.delete(codePoint);
    }

    private storeGlyph(
        codePoint: number,
        page: Page<T>,
        pos: { x: number; y: number },
        metrics: GlyphMetrics
    ): GlyphLocation<T> {
        const location: GlyphLocation<T> = {
            page: { texture: page.texture, width: page.width, height: page.height },
            x: pos.x,
            y: pos.y,
            width: metrics.width,
            height: metrics.height,
            metrics,
            empty: false,
            missing: false,
        };
        this.glyphIndex.set(codePoint, location);
        this.pendingGlyphs.delete(codePoint);
        return location;
    }

    private getOrCreatePage(isLatin: boolean, glyphHeight: number): Page<T> {
        if (isLatin) {
            if (!this.latinPage) {
                this.latinPage = new Page(this.pageSize, this.pageSize, this.textureFactory);
            }
            return this.latinPage;
        }

        // Find mixed page with space
        for (const page of this.mixedPages) {
            if (page.cursorY + glyphHeight <= page.height) {
                return page;
            }
        }

        return this.createMixedPage();
    }

    private createMixedPage(): Page<T> {
        if (this.mixedPages.length >= this.maxMixedPages) {
            console.warn(`VariantAtlas ${this.variantId}: max mixed pages reached, eviction not implemented`);
        }

        const page = new Page<T>(this.pageSize, this.pageSize, this.textureFactory);
        this.mixedPages.push(page);
        return page;
    }

    hasDirtyPages(): boolean {
        if (this.latinPage?.dirty) return true;
        for (const page of this.mixedPages) {
            if (page.dirty) return true;
        }
        return false;
    }

    flushDirtyPages(): void {
        this.latinPage?.flush();
        for (const page of this.mixedPages) {
            page.flush();
        }
    }

    getPageCount(): number {
        return (this.latinPage ? 1 : 0) + this.mixedPages.length;
    }

    getGlyphCount(): number {
        return this.glyphIndex.size;
    }

    getMemoryBytes(): number {
        const pageBytes = this.pageSize * this.pageSize * 4;
        return this.getPageCount() * pageBytes;
    }

    getLastAccessed(): number {
        return this.lastAccessed;
    }

    destroy(): void {
        this.latinPage?.destroy();
        for (const page of this.mixedPages) {
            page.destroy();
        }
        this.latinPage = null;
        this.mixedPages = [];
        this.glyphIndex.clear();
        this.pendingGlyphs.clear();
    }
}
