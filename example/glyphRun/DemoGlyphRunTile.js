// DemoGlyphRunTile.js - Layout data container for glyph runs
// Matches blockText's GlyphRunTile pattern: separates layout from rendering
//
// Layout system computes positions -> stored in tile -> renderer consumes tile

export class DemoGlyphRunTile {
   constructor(
      text,           // string - the characters
      xPositions,     // number[] - pen X position for each glyph (layout coordinates)
      yPositions,     // number[] - pen Y position for each glyph
      xOffsets,       // number[] - glyph xoffset from BMFont (added to pen position)
      yOffsets,       // number[] - glyph yoffset from BMFont
      widths,         // number[] - glyph width for each character
      heights,        // number[] - glyph height for each character
      totalAdvanceW,  // number - total advance width of run
      colours,        // Uint32Array - per-glyph color (RGBA as uint32)
      x,              // number - tile X position in output
      y               // number - tile Y position in output
   ) {
      this.text = text;
      this.xPositions = xPositions;
      this.yPositions = yPositions;
      this.xOffsets = xOffsets;
      this.yOffsets = yOffsets;
      this.widths = widths;
      this.heights = heights;
      this.totalAdvanceW = totalAdvanceW;
      this.colours = colours;
      this.backgroundColours = new Uint32Array(text.length);  // init to 0 (transparent)
      this.x = x;
      this.y = y;
   }

   get length() { return this.text.length; }

   setColour(index, colour) {
      if (index >= 0 && index < this.colours.length)
         this.colours[index] = colour;
   }

   setColourRange(start, end, colour) {
      const s = Math.max(0, start);
      const e = Math.min(this.colours.length, end);
      for (let i = s; i < e; i++)
         this.colours[i] = colour;
   }

   setBackgroundColour(index, colour) {
      if (index >= 0 && index < this.backgroundColours.length)
         this.backgroundColours[index] = colour;
   }

   setBackgroundColourRange(start, end, colour) {
      const s = Math.max(0, start);
      const e = Math.min(this.backgroundColours.length, end);
      for (let i = s; i < e; i++)
         this.backgroundColours[i] = colour;
   }
}

// Helper to create a tile from text + atlas JSON (simple layout)
// This does basic left-to-right layout - real layout would be more complex
export function createTileFromText(text, atlasJson, x = 0, y = 0, defaultColour = 0xFFFFFFFF) {
   const chars = atlasJson.chars;
   const len = text.length;

   const xPositions = [];
   const yPositions = [];
   const xOffsets = [];
   const yOffsets = [];
   const widths = [];
   const heights = [];
   const colours = new Uint32Array(len).fill(defaultColour);

   let cursorX = 0;

   for (let i = 0; i < len; i++) {
      const code = text.charCodeAt(i);
      const glyph = chars.find(c => c.id === code);

      if (glyph) {
         xPositions.push(cursorX);
         yPositions.push(0);  // baseline-relative
         xOffsets.push(glyph.xoffset);
         yOffsets.push(glyph.yoffset);
         widths.push(glyph.width);
         heights.push(glyph.height);
         cursorX += glyph.xadvance;
      } else {
         // Missing glyph - use space-like values
         xPositions.push(cursorX);
         yPositions.push(0);
         xOffsets.push(0);
         yOffsets.push(0);
         widths.push(0);
         heights.push(0);
         cursorX += atlasJson.info.size * 0.3;  // fallback advance
      }
   }

   return new DemoGlyphRunTile(
      text,
      xPositions,
      yPositions,
      xOffsets,
      yOffsets,
      widths,
      heights,
      cursorX,  // totalAdvanceW
      colours,
      x,
      y
   );
}
