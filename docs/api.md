# fontAtlas API

MSDF/MTSDF font atlas generator using msdfgen compiled to WebAssembly.

## What It Does

- Generates MSDF (3-channel) or MTSDF (4-channel) signed distance field glyphs from TTF/OTF fonts
- Packs glyphs into texture atlases with BMFont-compatible JSON metadata
- Provides runtime on-demand glyph generation with texture caching
- Supports variable fonts (weight, width, slant, etc.)
- Includes ready-to-use MSDF shaders for WebGL2 and WebGPU

## What It Does NOT Do

- Does not render text - you provide the rendering (Pixi, raw WebGL/WebGPU, Canvas, etc.)
- Does not handle text layout (line breaking, shaping, etc.) - use a text layout library
- Does not load fonts from URLs - you provide font bytes as Uint8Array
- Does not provide font metrics (ascent, descent, line height) - query those from the font separately

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              fontAtlas                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Layer 1: WASM Core                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  msdf-core.wasm + msdf-core.js (Emscripten)                         │   │
│  │  - C++ msdfgen compiled to WebAssembly                               │   │
│  │  - Input: font bytes, charCode, fontSize, pixelRange                 │   │
│  │  - Output: raw metrics + Float32Array pixel data                     │   │
│  │  - NO JSON, NO PNG - just raw data                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Layer 2: JavaScript Wrapper                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  MSDFGenerator                                                       │   │
│  │  - Wraps WASM, handles memory management                             │   │
│  │  - Single glyph at a time                                            │   │
│  │  - Returns MSDFGlyph { metrics, pixels }                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Layer 3: Atlas Generators                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  AtlasGenerator (batch/prefab)                                       │   │
│  │  - Generates multiple glyphs, packs into atlas                       │   │
│  │  - Outputs: PNG image + BMFont-compatible JSON                       │   │
│  │  - For: build-time atlas generation, CLI tools                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  FontAtlas (runtime/on-demand)                                       │   │
│  │  - Generates glyphs as requested, caches in texture pages            │   │
│  │  - Returns immediately with placeholder, async fills                 │   │
│  │  - For: runtime text rendering, dynamic content                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Class Summaries

| Class | Purpose |
|-------|---------|
| **MSDFGenerator** | Low-level WASM wrapper. Generates one glyph at a time. Returns raw metrics + pixels. |
| **AtlasGenerator** | Batch generator. Takes char list, produces PNG atlas + JSON metadata. |
| **FontAtlas** | Runtime cache. On-demand glyph generation with deferred batch processing. |
| **WorkerPool** | Parallel generation using worker threads (Node.js only). |

## Quick Start

```typescript
import { init } from 'font-atlas';

const { msdf, atlas } = await init('./msdf-core.wasm');

const fontBytes = new Uint8Array(await fetch('/fonts/MyFont.ttf').then(r => r.arrayBuffer()));

const chars = [];
for (let i = 32; i < 127; i++) chars.push(i);  // ASCII printable

const result = await atlas.generate(fontBytes, chars, 64, 4, 512, 'mtsdf');

// result.image   - Uint8Array RGBA pixels
// result.width   - atlas width
// result.height  - atlas height
// result.json    - BMFont-compatible JSON
// result.timing  - performance metrics
```

## Detailed API

### init(wasmPath, options?)

Initialize the library.

```typescript
const { msdf, atlas, createWorkerPool, dispose } = await init('./msdf-core.wasm', {
    numWorkers: 4,      // Worker threads (Node.js only, default: 0)
    workersOnly: false  // If true, main thread only coordinates (default: false)
});
```

### MSDFGenerator

Low-level single-glyph generator. Wraps WASM, one glyph per call.

```typescript
// Load font (must call before generate)
msdf.loadFont(fontBytes: Uint8Array): void

// Check if glyph exists in font (without generating)
msdf.hasGlyph(charCode: number): boolean

// Generate MSDF (3-channel RGB)
msdf.generate(charCode: number, fontSize?: number, pixelRange?: number): MSDFGlyph | null

// Generate MTSDF (4-channel RGBA with true SDF in alpha)
msdf.generateMTSDF(charCode: number, fontSize?: number, pixelRange?: number): MSDFGlyph | null

// Variable font support
msdf.setVariationAxes(axes: VariationAxis[]): void
msdf.clearVariationAxes(): void
msdf.generateVar(charCode, fontSize, pixelRange): MSDFGlyph | null
msdf.generateMTSDFVar(charCode, fontSize, pixelRange): MSDFGlyph | null

// Cleanup
msdf.dispose(): void
```

**MSDFGlyph structure:**
```typescript
interface MSDFGlyph {
    metrics: {
        width: number;          // Bitmap width in pixels
        height: number;         // Bitmap height in pixels
        advance: number;        // Horizontal advance (scaled to fontSize)
        planeBounds: {          // Glyph bounds in font units
            l: number;          // Left
            b: number;          // Bottom
            r: number;          // Right
            t: number;          // Top
        };
        atlasBounds: { l: number; b: number };  // Position in atlas (for packing)
    };
    pixels: Float32Array;       // Raw pixel data (RGB or RGBA floats, 0.0-1.0)
}
```

### AtlasGenerator

High-level batch generator. Produces complete atlas image + JSON.

```typescript
const result = await atlas.generate(
    fontBytes: Uint8Array,      // Font file
    chars: number[],            // Unicode codepoints to include
    fontSize?: number,          // Target size (default: 32)
    padding?: number,           // Pixels between glyphs (default: 2)
    fixedWidth?: number,        // Atlas width (height computed)
    type?: 'msdf' | 'mtsdf'     // Channel type (default: 'msdf')
): AtlasResult
```

**AtlasResult structure:**
```typescript
interface AtlasResult {
    image: Uint8Array;          // RGBA pixel data
    width: number;              // Atlas width
    height: number;             // Atlas height
    json: {                     // BMFont-compatible JSON
        info: { face, size, bold, italic, ... };
        common: { lineHeight, base, scaleW, scaleH, ... };
        chars: AtlasChar[];
    };
    type: 'msdf' | 'mtsdf';
    timing: AtlasTiming;
}
```

### FontAtlas

Runtime on-demand glyph cache. For dynamic text rendering.

**How it works:**
1. `getGlyph()` returns IMMEDIATELY with texture reference
2. If glyph not cached, generation is queued (returns `cached: false`)
3. Queued glyphs batch together via Promise microtask
4. When batch completes, textures update and `onGlyphsReady` fires
5. NO MANUAL PUMPING - fully automatic

**Two usage patterns:**

#### Pattern 1: Sync with prefabLatin (Recommended for Latin text)

Use `prefabLatin()` to generate all Latin characters synchronously BEFORE rendering. After it returns, all Latin glyphs are cached and `getGlyph()` returns `cached: true` immediately.

```typescript
import { init, FontAtlas } from 'font-atlas';

// 1. Initialize
const { msdf } = await init('./msdf-core.wasm');
const fontBytes = new Uint8Array(await fetch('/font.ttf').then(r => r.arrayBuffer()));

// 2. Create FontAtlas
const atlas = new FontAtlas(msdf, textureFactory, null, {
    genSizes: [32, 64],
    sizeThresholds: [48],
    pageSize: 512,
    pixelRange: 8
});

// 3. SYNC: Generate all Latin chars (a-z, A-Z, 0-9) - blocks until complete
atlas.prefabLatin('myVariant', 32, fontBytes);

// 4. Now all Latin glyphs are ready - no async, no callbacks
const info = atlas.getGlyph({
    codePoint: 65,  // 'A'
    variantId: 'myVariant',
    fontBuffer: fontBytes,
    renderSize: 32
});
// info.cached === true (guaranteed after prefabLatin)
// info.texture, info.uvs, info.metrics all ready
```

#### Pattern 2: Async with getGlyph (For dynamic/unknown text)

Use `getGlyph()` directly. First call queues generation, `onGlyphsReady` fires when batch completes.

```typescript
const atlas = new FontAtlas(msdf, textureFactory, onGlyphsReady, config);

function onGlyphsReady() {
    // Async batch complete - re-render text
    rebuildMesh();
}

// Request glyph - may not be ready yet
const info = atlas.getGlyph({ codePoint: 65, variantId: 'v', fontBuffer, renderSize: 32 });

if (info.cached) {
    // Ready now - use info.texture, info.uvs
} else {
    // Queued - will be ready when onGlyphsReady fires
    // info.texture exists but may have placeholder pixels
}
```

#### Constructor and Methods

```typescript
const atlas = new FontAtlas<YourTextureType>(
    msdf,                       // MSDFGenerator instance
    textureFactory,             // Your TextureFactory implementation
    onGlyphsReady,              // Callback when async batch completes (null if sync only)
    {
        genSizes: [32, 64, 128],    // Available generation sizes
        sizeThresholds: [40, 80],   // renderSize < 40 → 32px, < 80 → 64px, else 128px
        pageSize: 1024,             // Texture atlas page size
        maxMixedPages: 8,           // Max pages for non-Latin chars
        pixelRange: 4,              // MSDF pixel range
    }
);

// Get glyph info (returns immediately)
atlas.getGlyph(request: GlyphRequest): GlyphInfo

// Synchronous prefab - generates all Latin chars (a-z, A-Z, 0-9)
// Blocks until complete. After return, getGlyph() for these chars returns cached=true.
atlas.prefabLatin(variantId: string, fontSize: number, fontBuffer: Uint8Array, variationAxes?: VariationAxis[]): void

// State
atlas.hasPendingWork: boolean   // True if glyphs queued for async generation
atlas.getStatus(): AtlasStatus  // Cache stats (atlasCount, pageCount, glyphCount, memoryBytes)
atlas.dispose(): void           // Cleanup all textures and pages
```

**GlyphInfo structure:**
```typescript
interface GlyphInfo<T> {
    texture: T;                 // Page texture (from your TextureFactory)
    uvs: { u0, v0, u1, v1 };    // Normalized UV coordinates
    metrics: GlyphMetrics;      // width, height, advance, xOffset, yOffset, planeBounds
    genSize: number;            // Actual generation size used
    cached: boolean;            // true = ready, false = queued for generation
    empty: boolean;             // true = no pixels to render (space, etc.)
    missing: boolean;           // true = glyph not in font
}
```

**Handling empty/missing glyphs:**
```typescript
const info = atlas.getGlyph({ codePoint, variantId, fontBuffer, renderSize });

if (info.missing) {
    // Glyph not in font - use fallback font or show placeholder
} else if (info.empty) {
    // Glyph exists but has no pixels (e.g., space) - just advance cursor
} else if (info.cached) {
    // Normal glyph ready to render
    renderGlyph(info.texture, info.uvs);
}
// Always advance cursor using info.metrics.advance
```

**TextureFactory interface:**
```typescript
interface TextureFactory<T> {
    create(width: number, height: number, buffer: Uint8Array): T;
    update(texture: T, buffer: Uint8Array): void;
    destroy(texture: T): void;
}
```

**Important notes:**
- `getGlyph()` ALWAYS returns immediately - check `cached` to know if ready
- Multiple `getGlyph()` calls in same frame batch together automatically
- `onGlyphsReady` fires once per batch, not per glyph
- For Latin text, use `prefabLatin()` to avoid async complexity entirely
- FontAtlas caches by `variantId + genSize` internally - no need for external cache

## JSON Format (AtlasChar)

BMFont-compatible glyph metadata:

```typescript
interface AtlasChar {
    id: number;       // Unicode codepoint
    x: number;        // X position in atlas (pixels)
    y: number;        // Y position in atlas (pixels)
    width: number;    // Glyph width in atlas (pixels)
    height: number;   // Glyph height in atlas (pixels)
    xoffset: number;  // Horizontal offset when rendering
    yoffset: number;  // Vertical offset when rendering
    xadvance: number; // Horizontal advance after this glyph
    page: number;     // Page index (always 0 for AtlasGenerator)
    chnl: number;     // Channel mask (always 15 = all channels)
}
```

**Coordinate system:**
- Atlas origin: top-left (0,0)
- xoffset/yoffset: derived from glyph's planeBounds (font units scaled to pixels)
- xadvance: horizontal distance to next glyph origin

## MSDF Shaders

Ready-to-use shaders with Pixi.js v8 compatible naming conventions.

```javascript
import { msdfVertGLSL, msdfFragGLSL, msdfWGSL } from 'font-atlas/shaders.js';
```

**WebGL2:**
```javascript
const program = createProgram(gl, msdfVertGLSL, msdfFragGLSL);
```

**WebGPU:**
```javascript
const shaderModule = device.createShaderModule({ code: msdfWGSL });
```

**Binding conventions:**
- `@group(0)`: Pixi GlobalUniforms (projection, world transform, etc.) - auto-bound by Pixi
- `@group(1)`: Custom uniforms + texture + sampler - you provide

**Required attributes:** `aPosition` (vec2), `aUV` (vec2)

**Custom uniforms in `@group(1) @binding(0)`:**
```
uColor, uDebugColor, uViewport, uOutlineColor, uGlowColor, uGlowOffset,
uTexSize, uSmoothing, uWeight, uUseAlpha, uPxRange, uFancyEnable,
uShowMedian, uOutlineOnOff, uOutlineWidth, uGlowOnOff, uGlowRadius,
uGlowAlpha, uGlowDiffusion, uBlurOnOff, uCharBlur, uDebugMode
```

## Files in Release Package

```
dist/release/
├── fontAtlas-node.js      # Node.js ESM bundle
├── fontAtlas-browser.js   # Browser ESM bundle
├── fontAtlas-deno.js      # Deno ESM bundle
├── fontAtlas.d.ts         # TypeScript declarations
├── msdf-core.js           # WASM loader
├── msdf-core.wasm         # WebAssembly binary
└── shaders.js             # MSDF shaders (GLSL + WGSL)
```

## Parallel Generation (Node.js)

Use worker threads to speed up batch generation:

```typescript
const { atlas, createWorkerPool, dispose } = await init('./msdf-core.wasm', {
    numWorkers: 4
});

const fontBytes = new Uint8Array(...);
await createWorkerPool(fontBytes);

const result = await atlas.generate(fontBytes, chars, 64, 4, 512, 'mtsdf');

console.log(`Total: ${result.timing.totalMs}ms`);
console.log(`Workers: ${result.timing.numWorkers}`);
console.log(`Median per glyph: ${result.timing.medianGlyphMs}ms`);

await dispose();
```

---

## WASM Core Internals

This section documents the raw WASM API. You don't normally use this directly - use `MSDFGenerator` instead. This is for understanding internals or building custom integrations.

### Files

| File | Purpose |
|------|---------|
| `src/wasm/core.h` | C++ glyph generation logic |
| `src/wasm/wasm_binding.cpp` | Emscripten bindings exposing C++ to JS |
| `msdf-atlas-gen/` | Upstream msdfgen C++ library (git submodule) |

**Build:** `make -f Makefile.wasm` → `dist/msdf-core.js` + `dist/msdf-core.wasm`

### Exported Functions

```c
// Allocate persistent buffer for font data, returns pointer
int _prepare_font_buffer(int length);

// Generate 3-channel MSDF glyph
// Returns pointer to pixel data (Float32Array), writes metrics to metricsPtr
int _generate_glyph(int fontLen, int charCode, float fontSize, float pixelRange, int metricsPtr);

// Generate 4-channel MTSDF glyph (RGB + true SDF in alpha)
int _generate_mtsdf_glyph(int fontLen, int charCode, float fontSize, float pixelRange, int metricsPtr);

// Variable font versions
int _generate_glyph_var(int fontLen, int charCode, float fontSize, float pixelRange, int metricsPtr);
int _generate_mtsdf_glyph_var(int fontLen, int charCode, float fontSize, float pixelRange, int metricsPtr);

// Variable font axis management
void _clear_variation_axes();
void _add_variation_axis(const char* tag, float value);  // tag: "wght", "wdth", "opsz", "ital", "slnt"

// Check if glyph exists in font (returns 1 if exists, 0 if not)
int _has_glyph(int fontLen, int charCode);

// Cleanup
void _free_buffers();
```

### Metrics Output Format

The `metricsPtr` parameter points to a 40-byte buffer (10 floats):

| Offset | Field | Description |
|--------|-------|-------------|
| 0 | success | 1.0 if successful, 0.0 if failed |
| 1 | width | Bitmap width in pixels |
| 2 | height | Bitmap height in pixels |
| 3 | advance | Horizontal advance (pixels, scaled to fontSize) |
| 4 | planeBounds.l | Left edge relative to origin (pixels) |
| 5 | planeBounds.b | Bottom edge relative to baseline (pixels) |
| 6 | planeBounds.r | Right edge relative to origin (pixels) |
| 7 | planeBounds.t | Top edge relative to baseline (pixels) |
| 8 | atlasBounds.l | Reserved (0) |
| 9 | atlasBounds.b | Reserved (0) |

### Pixel Data Format

The returned pointer points to `width * height * channels` floats:
- MSDF: 3 channels (RGB), values 0.0-1.0
- MTSDF: 4 channels (RGBA), values 0.0-1.0

Memory layout is row-major, top-to-bottom, RGB(A) interleaved.

### Usage Pattern (Raw)

```javascript
// 1. Load WASM module
const mod = await MSdfCoreFactory();

// 2. Allocate font buffer
const fontLen = fontBytes.byteLength;
const fontPtr = mod._prepare_font_buffer(fontLen);
mod.HEAPU8.set(fontBytes, fontPtr);

// 3. Allocate metrics output
const metricsPtr = mod._malloc(40);

// 4. Generate glyph
const pixelsPtr = mod._generate_glyph(fontLen, 65 /* 'A' */, 32.0, 4.0, metricsPtr);

// 5. Read metrics
const m = metricsPtr >> 2;  // Float32 index
const success = mod.HEAPF32[m + 0];
const width = mod.HEAPF32[m + 1];
const height = mod.HEAPF32[m + 2];
const advance = mod.HEAPF32[m + 3];
// ... etc

// 6. Read pixels
const pixelCount = width * height * 3;
const pixels = new Float32Array(pixelCount);
pixels.set(mod.HEAPF32.subarray(pixelsPtr >> 2, (pixelsPtr >> 2) + pixelCount));

// 7. Cleanup
mod._free(metricsPtr);
mod._free_buffers();
```

### GlyphResult (C++ struct)

```cpp
struct GlyphResult {
    bool success;
    int width;
    int height;
    int channels;           // 3 for MSDF, 4 for MTSDF
    float advance;
    float planeBounds[4];   // L, B, R, T
    float atlasBounds[4];   // Reserved
    std::vector<float> pixels;
};
```

### Variable Font Support

```javascript
// Set axes before calling _generate_glyph_var or _generate_mtsdf_glyph_var
mod._clear_variation_axes();
mod.ccall('_add_variation_axis', null, ['string', 'number'], ['wght', 700]);
mod.ccall('_add_variation_axis', null, ['string', 'number'], ['wdth', 75]);

const pixelsPtr = mod._generate_mtsdf_glyph_var(fontLen, 65, 32.0, 4.0, metricsPtr);
```

Supported axis tags: `wght` (Weight), `wdth` (Width), `opsz` (Optical Size), `ital` (Italic), `slnt` (Slant)
