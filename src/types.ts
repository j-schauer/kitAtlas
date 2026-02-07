import type { VariationAxis } from '../msdf-generator';

// Texture factory - injected by consumer (PixiJS, WebGPU, etc.)
export interface TextureFactory<T> {
    create(width: number, height: number, buffer: Uint8Array): T;
    update(texture: T, buffer: Uint8Array): void;
    destroy(texture: T): void;
}

// Request for a single glyph
export interface GlyphRequest {
    codePoint: number;
    variantId: string;
    fontBuffer: Uint8Array;
    variationAxes?: VariationAxis[];
    renderSize: number;
}

// Returned glyph info with texture reference
export interface GlyphInfo<T> {
    texture: T;
    uvs: { u0: number; v0: number; u1: number; v1: number };
    metrics: GlyphMetrics;
    genSize: number;
    cached: boolean;
    empty: boolean;    // true if glyph has no pixels (space, etc.) - still has valid advance
    missing: boolean;  // true if glyph not in font at all
}

// Glyph metrics for layout
export interface GlyphMetrics {
    width: number;
    height: number;
    advance: number;
    xOffset: number;
    yOffset: number;
    planeBounds: { l: number; b: number; r: number; t: number };
}

// Atlas configuration
export interface AtlasConfig {
    genSizes: number[];
    sizeThresholds: number[];
    pageSize: number;
    maxMixedPages: number;
    pixelRange: number;
}

// Status for debugging/monitoring
export interface AtlasStatus {
    atlasCount: number;
    pageCount: number;
    glyphCount: number;
    memoryBytes: number;
}

// Internal: location of a glyph within a page
export interface GlyphLocation<T> {
    page: { texture: T; width: number; height: number };
    x: number;
    y: number;
    width: number;
    height: number;
    metrics: GlyphMetrics;
    empty: boolean;    // no pixels to render
    missing: boolean;  // glyph not in font
}

// Default config
export const DEFAULT_CONFIG: AtlasConfig = {
    genSizes: [32, 64, 128],
    sizeThresholds: [40, 80],
    pageSize: 1024,
    maxMixedPages: 8,
    pixelRange: 4,
};

// Latin character set (a-zA-Z0-9)
const LATIN_RANGES: [number, number][] = [
    [0x30, 0x39],  // 0-9
    [0x41, 0x5A],  // A-Z
    [0x61, 0x7A],  // a-z
];

export function isLatinChar(codePoint: number): boolean {
    for (const [start, end] of LATIN_RANGES) {
        if (codePoint >= start && codePoint <= end) return true;
    }
    return false;
}

// All Latin codepoints as array (62 chars: 0-9, A-Z, a-z)
export const LATIN_CODEPOINTS: number[] = [];
for (const [start, end] of LATIN_RANGES) {
    for (let cp = start; cp <= end; cp++) {
        LATIN_CODEPOINTS.push(cp);
    }
}
