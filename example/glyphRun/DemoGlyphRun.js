// DemoGlyphRun.js - Glyph run renderer consuming DemoGlyphRunTile
// Matches blockText's PixiGlyphRunNode pattern: tile contains layout, node renders
//
// Usage:
//   const tile = createTileFromText('Hello', atlasJson, x, y);
//   const node = new DemoGlyphRun(PIXI, { texture, atlasJson, pxRange: 8 });
//   node.renderTile(tile, scale);

import { msdfWGSL } from '../../src/shaders.js';

// Shared shader program - reused across instances
let _gpuProgram = null;

function getGpuProgram(PIXI) {
    if (!_gpuProgram) {
        _gpuProgram = PIXI.GpuProgram.from({
            vertex: { source: msdfWGSL, entryPoint: 'vs_main' },
            fragment: { source: msdfWGSL, entryPoint: 'fs_main' }
        });
    }
    return _gpuProgram;
}

export class DemoGlyphRun {
    constructor(PIXI, options = {}) {
        this.PIXI = PIXI;
        this.container = new PIXI.Container();
        this.debugGraphics = new PIXI.Graphics();
        this.container.addChild(this.debugGraphics);
        this.mesh = null;
        this.geometry = null;
        this.shader = null;
        this.uniforms = null;

        // Atlas info
        this.texture = options.texture || null;
        this.atlasJson = options.atlasJson || null;
        this.pxRange = options.pxRange || 8;
        this.showDebugQuads = options.showDebugQuads ?? true;
        this.fontSize = options.fontSize || 48;  // display size

        // Current tile
        this.tile = null;
    }

    // Set atlas texture and JSON
    setAtlas(texture, atlasJson) {
        this.texture = texture;
        this.atlasJson = atlasJson;
    }

    // Render from a tile (layout data container)
    // scale: multiplier for display size (e.g., displaySize / atlasSize)
    renderTile(tile, scale = 1, options = {}) {
        const PIXI = this.PIXI;
        this.tile = tile;

        if (this.mesh) {
            this.container.removeChild(this.mesh);
            this.mesh.destroy();
            this.mesh = null;
        }

        if (!this.texture || !this.atlasJson) {
            console.error('DemoGlyphRun: No atlas set');
            return 0;
        }

        const json = this.atlasJson;
        const chars = json.chars;
        const len = tile.length;

        console.log(`--- Tile Render v2026.02.05c: len=${len}, scale=${scale.toFixed(4)} ---`);

        // Build glyph data from tile
        const glyphData = [];
        const baseX = tile.x;
        const baseY = tile.y;

        for (let i = 0; i < len; i++) {
            const code = tile.text.charCodeAt(i);
            const glyph = chars.find(c => c.id === code);
            if (!glyph) continue;

            // Position from tile (pre-computed layout) + offset from glyph
            const gx = (baseX + tile.xPositions[i] + tile.xOffsets[i]) * scale;
            const gy = (baseY + tile.yPositions[i] + tile.yOffsets[i]) * scale;
            const gw = tile.widths[i] * scale;
            const gh = tile.heights[i] * scale;

            // UVs from atlas JSON
            const u0 = glyph.x / json.common.scaleW;
            const v0 = glyph.y / json.common.scaleH;
            const u1 = (glyph.x + glyph.width) / json.common.scaleW;
            const v1 = (glyph.y + glyph.height) / json.common.scaleH;

            glyphData.push({ x: gx, y: gy, w: gw, h: gh, u0, v0, u1, v1, colour: tile.colours[i] });
        }

        if (glyphData.length === 0) return 0;

        // Draw debug quads
        this.debugGraphics.clear();
        if (this.showDebugQuads) {
            const debugColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800, 0x8800ff];
            for (let i = 0; i < glyphData.length; i++) {
                const g = glyphData[i];
                const color = debugColors[i % debugColors.length];
                this.debugGraphics.rect(g.x, g.y, g.w, g.h);
                this.debugGraphics.fill({ color, alpha: 0.3 });
                this.debugGraphics.stroke({ color, width: 1, alpha: 0.8 });
            }
        }

        // Allocate buffers
        const positions = new Float32Array(glyphData.length * 4 * 2);
        const uvs = new Float32Array(glyphData.length * 4 * 2);
        const indices = new Uint32Array(glyphData.length * 6);

        let vPos = 0, uvPos = 0, idxPos = 0;
        for (let i = 0; i < glyphData.length; i++) {
            const g = glyphData[i];

            // Quad vertices: TL, TR, BR, BL
            positions[vPos++] = g.x;
            positions[vPos++] = g.y;
            positions[vPos++] = g.x + g.w;
            positions[vPos++] = g.y;
            positions[vPos++] = g.x + g.w;
            positions[vPos++] = g.y + g.h;
            positions[vPos++] = g.x;
            positions[vPos++] = g.y + g.h;

            // UVs
            uvs[uvPos++] = g.u0;
            uvs[uvPos++] = g.v0;
            uvs[uvPos++] = g.u1;
            uvs[uvPos++] = g.v0;
            uvs[uvPos++] = g.u1;
            uvs[uvPos++] = g.v1;
            uvs[uvPos++] = g.u0;
            uvs[uvPos++] = g.v1;

            // Indices
            const base = i * 4;
            indices[idxPos++] = base;
            indices[idxPos++] = base + 1;
            indices[idxPos++] = base + 2;
            indices[idxPos++] = base;
            indices[idxPos++] = base + 2;
            indices[idxPos++] = base + 3;
        }

        this.geometry = new PIXI.MeshGeometry({ positions, uvs, indices });

        // Create uniforms
        const color = options.color || [1, 1, 1, 1];
        this.uniforms = new PIXI.UniformGroup({
            uColor: { value: color, type: 'vec4<f32>' },
            uDebugColor: { value: [1, 0, 1, 1], type: 'vec4<f32>' },
            uViewport: { value: [0, 0, 800, 600], type: 'vec4<f32>' },
            uOutlineColor: { value: [0, 0, 0, 1], type: 'vec4<f32>' },
            uGlowColor: { value: [0, 0.5, 1, 1], type: 'vec4<f32>' },
            uGlowOffset: { value: [0, 0], type: 'vec2<f32>' },
            uTexSize: { value: [json.common.scaleW, json.common.scaleH], type: 'vec2<f32>' },
            uSmoothing: { value: options.smoothing ?? 1.0, type: 'f32' },
            uWeight: { value: options.weight ?? 0, type: 'f32' },
            uUseAlpha: { value: options.useAlpha ?? 0, type: 'f32' },
            uPxRange: { value: this.pxRange, type: 'f32' },
            uFancyEnable: { value: 0, type: 'f32' },
            uShowMedian: { value: 0, type: 'f32' },
            uOutlineOnOff: { value: 0, type: 'f32' },
            uOutlineWidth: { value: 0, type: 'f32' },
            uGlowOnOff: { value: 0, type: 'f32' },
            uGlowRadius: { value: 0, type: 'f32' },
            uGlowAlpha: { value: 0, type: 'f32' },
            uGlowDiffusion: { value: 0, type: 'f32' },
            uBlurOnOff: { value: 0, type: 'f32' },
            uCharBlur: { value: 0, type: 'f32' },
            uDebugMode: { value: options.debugMode ?? 0, type: 'i32' },
            _pad: { value: [0, 0, 0], type: 'vec3<f32>' },
        });

        this.shader = new PIXI.Shader({
            gpuProgram: getGpuProgram(PIXI),
            resources: {
                u: this.uniforms,
                uTexture: this.texture.source,
                uSampler: this.texture.source.style
            }
        });

        this.mesh = new PIXI.Mesh({
            geometry: this.geometry,
            shader: this.shader
        });

        this.container.addChild(this.mesh);
        return glyphData.length;
    }

    // Legacy method - creates tile internally then renders
    // Kept for backwards compatibility with existing demo code
    renderText(text, x = 0, y = 0, options = {}) {
        if (!this.atlasJson) {
            console.error('DemoGlyphRun: No atlas set');
            return 0;
        }

        // Simple inline tile creation (no import needed)
        const json = this.atlasJson;
        const chars = json.chars;
        const len = text.length;
        const fontSize = options.fontSize || this.fontSize;
        const scale = fontSize / json.info.size;

        const xPositions = [];
        const yPositions = [];
        const xOffsets = [];
        const yOffsets = [];
        const widths = [];
        const heights = [];
        const colours = new Uint32Array(len).fill(0xFFFFFFFF);

        let cursorX = 0;
        for (let i = 0; i < len; i++) {
            const code = text.charCodeAt(i);
            const glyph = chars.find(c => c.id === code);
            if (glyph) {
                xPositions.push(cursorX);
                yPositions.push(0);
                xOffsets.push(glyph.xoffset);
                yOffsets.push(glyph.yoffset);
                widths.push(glyph.width);
                heights.push(glyph.height);
                cursorX += glyph.xadvance;
            } else {
                xPositions.push(cursorX);
                yPositions.push(0);
                xOffsets.push(0);
                yOffsets.push(0);
                widths.push(0);
                heights.push(0);
                cursorX += json.info.size * 0.3;
            }
        }

        const tile = {
            text,
            xPositions,
            yPositions,
            xOffsets,
            yOffsets,
            widths,
            heights,
            totalAdvanceW: cursorX,
            colours,
            backgroundColours: new Uint32Array(len),
            x,
            y,
            get length() { return this.text.length; }
        };

        return this.renderTile(tile, scale, options);
    }

    // Update uniform values
    setUniform(name, value) {
        if (this.uniforms && this.uniforms.uniforms[name] !== undefined) {
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    this.uniforms.uniforms[name][i] = value[i];
                }
            } else {
                this.uniforms.uniforms[name] = value;
            }
        }
    }

    destroy() {
        if (this.mesh) {
            this.mesh.destroy();
            this.mesh = null;
        }
        if (this.geometry) {
            this.geometry.destroy();
            this.geometry = null;
        }
        if (this.shader) {
            this.shader.destroy();
            this.shader = null;
        }
        this.container.destroy({ children: true });
    }
}
