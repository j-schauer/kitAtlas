/**
 * kitAtlas - Font atlas management
 *
 * Provides caching, paging, and batching on top of kitMSDF.
 */

// FontAtlas - main on-demand glyph cache
export { FontAtlas } from './FontAtlas.js';
export { VariantAtlas } from './VariantAtlas.js';
export { Page } from './Page.js';

// AtlasGenerator - batch generation of entire atlas sheets
export { AtlasGenerator, AtlasResult, AtlasTiming, AtlasChar } from './AtlasGenerator.js';

// WorkerPool - parallel glyph generation
export { WorkerPool, WorkerPoolOptions } from './worker/WorkerPool.js';

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
