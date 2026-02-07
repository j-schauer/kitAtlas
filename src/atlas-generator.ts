import { MSDFGenerator, MSDFGlyph } from '../lib/kitMSDF/kitMSDF.js';
import { WorkerPool } from './worker-pool.js';

export interface AtlasChar {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    xoffset: number;
    yoffset: number;
    xadvance: number;
    page: number;
    chnl: number;
}

export interface AtlasTiming {
    totalMs: number;
    glyphGenMs: number;
    layoutMs: number;
    stitchMs: number;
    glyphTimes: number[];      // Per-glyph generation times
    medianGlyphMs: number;
    avgGlyphMs: number;
    glyphCount: number;
    numWorkers: number;
}

export interface AtlasResult {
    image: Uint8Array;
    width: number;
    height: number;
    json: any;
    type: 'msdf' | 'mtsdf';
    timing: AtlasTiming;
}

export class AtlasGenerator {
    private gen: MSDFGenerator;
    private pool: WorkerPool | null = null;

    constructor(generator: MSDFGenerator) {
        this.gen = generator;
    }

    setWorkerPool(pool: WorkerPool) {
        this.pool = pool;
    }

    async generate(
        fontBytes: Uint8Array,
        chars: number[],
        fontSize: number = 32,
        padding: number = 2,
        fixedWidth: number = 512,
        type: 'msdf' | 'mtsdf' = 'msdf'
    ): Promise<AtlasResult> {
        const totalStart = performance.now();

        const glyphs: { code: number; data: MSDFGlyph }[] = [];
        const glyphTimes: number[] = [];
        const range = padding * 2;

        const glyphStart = performance.now();

        if (this.pool && this.pool.workerCount > 0) {
            // Parallel generation via worker pool
            const results = await this.pool.generateBatch(chars, fontSize, range, type);

            for (const result of results) {
                glyphTimes.push(result.timeMs);
                if (result.success && result.metrics && result.pixels) {
                    glyphs.push({
                        code: result.charCode,
                        data: {
                            metrics: {
                                ...result.metrics,
                                atlasBounds: { l: 0, b: 0 }
                            },
                            pixels: result.pixels
                        }
                    });
                }
            }
        } else {
            // Sequential generation on main thread
            this.gen.loadFont(fontBytes);

            for (const code of chars) {
                const start = performance.now();
                const data = type === 'mtsdf'
                    ? this.gen.generateMTSDF(code, fontSize, range)
                    : this.gen.generate(code, fontSize, range);
                const elapsed = performance.now() - start;
                glyphTimes.push(elapsed);

                if (data) {
                    glyphs.push({ code, data });
                }
            }
        }

        const glyphGenMs = performance.now() - glyphStart;

        // Layout phase
        const layoutStart = performance.now();

        glyphs.sort((a, b) => b.data.metrics.height - a.data.metrics.height);

        let currentX = padding;
        let currentY = padding;
        let rowHeight = 0;
        let finalHeight = 0;

        const layout: { code: number; x: number; y: number; w: number; h: number; data: MSDFGlyph }[] = [];

        for (const item of glyphs) {
            const g = item.data;
            const gw = g.metrics.width;
            const gh = g.metrics.height;

            if (currentX + gw + padding > fixedWidth) {
                currentX = padding;
                currentY += rowHeight + padding;
                rowHeight = 0;
            }

            layout.push({
                code: item.code,
                x: currentX,
                y: currentY,
                w: gw,
                h: gh,
                data: g
            });

            currentX += gw + padding;
            rowHeight = Math.max(rowHeight, gh);
        }

        finalHeight = currentY + rowHeight + padding;
        const layoutMs = performance.now() - layoutStart;

        // Stitch phase
        const stitchStart = performance.now();

        const atlasWidth = fixedWidth;
        const atlasHeight = finalHeight;
        const buffer = new Uint8Array(atlasWidth * atlasHeight * 4);
        const channels = type === 'mtsdf' ? 4 : 3;

        const toU8 = (v: number): number => {
            v = Math.min(1, Math.max(0, v));
            return (v * 255 + 0.5) | 0;
        };

        const setPixel = (x: number, y: number, r: number, g: number, b: number, a: number) => {
            const idx = (y * atlasWidth + x) * 4;
            buffer[idx + 0] = r;
            buffer[idx + 1] = g;
            buffer[idx + 2] = b;
            buffer[idx + 3] = a;
        };

        const placedGlyphs: AtlasChar[] = [];
        const base = Math.ceil(fontSize * 0.8);

        for (const item of layout) {
            const { x, y, w, h, data } = item;

            for (let py = 0; py < h; py++) {
                for (let px = 0; px < w; px++) {
                    const srcIdx = (py * w + px) * channels;

                    let r, gVal, b, aVal;

                    if (type === 'mtsdf') {
                        r = toU8(data.pixels[srcIdx + 0]);
                        gVal = toU8(data.pixels[srcIdx + 1]);
                        b = toU8(data.pixels[srcIdx + 2]);
                        aVal = toU8(data.pixels[srcIdx + 3]);
                    } else {
                        r = toU8(data.pixels[srcIdx + 0]);
                        gVal = toU8(data.pixels[srcIdx + 1]);
                        b = toU8(data.pixels[srcIdx + 2]);
                        aVal = 255;
                    }

                    setPixel(x + px, y + (h - 1 - py), r, gVal, b, aVal);
                }
            }

            placedGlyphs.push({
                id: item.code,
                x: x,
                y: y,
                width: w,
                height: h,
                xoffset: data.metrics.planeBounds.l,
                yoffset: base - data.metrics.planeBounds.t,
                xadvance: data.metrics.advance,
                page: 0,
                chnl: 15
            });
        }

        const stitchMs = performance.now() - stitchStart;
        const totalMs = performance.now() - totalStart;

        // Calculate timing stats
        const sortedTimes = [...glyphTimes].sort((a, b) => a - b);
        const medianGlyphMs = sortedTimes.length > 0
            ? sortedTimes[Math.floor(sortedTimes.length / 2)]
            : 0;
        const avgGlyphMs = glyphTimes.length > 0
            ? glyphTimes.reduce((a, b) => a + b, 0) / glyphTimes.length
            : 0;

        const json = {
            pages: ["atlas.png"],
            chars: placedGlyphs,
            info: { face: "test", size: fontSize, type: type },
            common: { lineHeight: fontSize * 1.2, base: base, scaleW: atlasWidth, scaleH: atlasHeight }
        };

        return {
            image: buffer,
            width: atlasWidth,
            height: atlasHeight,
            json: json,
            type: type,
            timing: {
                totalMs,
                glyphGenMs,
                layoutMs,
                stitchMs,
                glyphTimes,
                medianGlyphMs,
                avgGlyphMs,
                glyphCount: glyphs.length,
                numWorkers: this.pool?.workerCount ?? 0
            }
        };
    }
}
