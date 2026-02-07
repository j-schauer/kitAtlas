/**
 * kitAtlas - Font atlas management
 *
 * Provides caching, paging, and batching on top of kitMSDF.
 */

// FontAtlas - main on-demand glyph cache
export { FontAtlas } from './font-atlas.js';
export { VariantAtlas } from './variant-atlas.js';
export { Page } from './page.js';

// AtlasGenerator - batch generation of entire atlas sheets
export { AtlasGenerator, AtlasResult, AtlasTiming, AtlasChar } from './atlas-generator.js';

// WorkerPool - parallel glyph generation
export { WorkerPool, WorkerPoolOptions } from './worker-pool.js';

// Types
export {
    TextureFactory,
    GlyphRequest,
    GlyphInfo,
    GlyphMetrics,
    GlyphLocation,
    AtlasConfig,
    AtlasStatus,
    DEFAULT_CONFIG,
    isLatinChar,
    LATIN_CODEPOINTS,
} from './types.js';

// Re-export from kitMSDF for convenience
export { MSDFGenerator, MSDFGlyph, MSDFMetrics, VariationAxis } from '../lib/kitMSDF/kitMSDF.js';
