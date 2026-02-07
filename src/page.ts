import type { TextureFactory } from './types.js';

export class Page<T> {
    readonly width: number;
    readonly height: number;

    buffer: Uint8Array;
    texture: T;
    cursorX: number = 0;
    cursorY: number = 0;
    rowHeight: number = 0;
    dirty: boolean = false;
    lastAccessed: number = Date.now();

    private textureFactory: TextureFactory<T>;
    private padding: number = 1;

    constructor(width: number, height: number, textureFactory: TextureFactory<T>) {
        this.width = width;
        this.height = height;
        this.textureFactory = textureFactory;
        this.buffer = new Uint8Array(width * height * 4);
        this.texture = textureFactory.create(width, height, this.buffer);
    }

    // Try to add glyph pixels to this page
    // Returns position if successful, null if no space
    tryAdd(pixels: Uint8Array, w: number, h: number): { x: number; y: number } | null {
        const paddedW = w + this.padding;
        const paddedH = h + this.padding;

        // Check if fits in current row
        if (this.cursorX + paddedW > this.width) {
            // Move to next row
            this.cursorY += this.rowHeight + this.padding;
            this.cursorX = 0;
            this.rowHeight = 0;
        }

        // Check if fits vertically
        if (this.cursorY + paddedH > this.height) {
            return null;
        }

        const x = this.cursorX;
        const y = this.cursorY;

        // Copy pixels to buffer (RGBA) - flip Y to match atlas coordinate system
        for (let row = 0; row < h; row++) {
            const srcOffset = row * w * 4;
            const dstRow = h - 1 - row;  // Flip Y
            const dstOffset = ((y + dstRow) * this.width + x) * 4;
            for (let col = 0; col < w * 4; col++) {
                this.buffer[dstOffset + col] = pixels[srcOffset + col];
            }
        }

        this.cursorX += paddedW;
        this.rowHeight = Math.max(this.rowHeight, paddedH);
        this.dirty = true;
        this.lastAccessed = Date.now();

        return { x, y };
    }

    // Update texture if buffer has changed
    flush(): void {
        if (this.dirty) {
            this.textureFactory.update(this.texture, this.buffer);
            this.dirty = false;
        }
    }

    destroy(): void {
        this.textureFactory.destroy(this.texture);
    }
}
