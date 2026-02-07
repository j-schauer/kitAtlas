/**
 * Worker pool for parallel glyph generation (Deno)
 * Uses Web Worker API with file:// URLs
 */

interface GlyphResult {
    charCode: number;
    success: boolean;
    metrics?: {
        width: number;
        height: number;
        advance: number;
        planeBounds: { l: number; b: number; r: number; t: number };
    };
    pixels?: Float32Array;
    timeMs: number;
}

interface PendingTask {
    charCode: number;
    resolve: (result: GlyphResult) => void;
}

export interface WorkerPoolOptions {
    numWorkers: number;
    workersOnly?: boolean;
}

export class WorkerPoolDeno {
    private workers: Worker[] = [];
    private available: Worker[] = [];
    private taskQueue: Array<{
        charCode: number;
        fontSize: number;
        pixelRange: number;
        glyphType: 'msdf' | 'mtsdf';
        resolve: (result: GlyphResult) => void;
    }> = [];
    private workerTasks: Map<Worker, PendingTask> = new Map();
    private ready: Promise<void>;
    private workersOnly: boolean;

    constructor(
        private workerUrl: string,
        private wasmJsUrl: string,
        private wasmBinaryUrl: string,
        private fontBytes: Uint8Array,
        options: WorkerPoolOptions
    ) {
        this.workersOnly = options.workersOnly ?? false;
        this.ready = this.initWorkers(options.numWorkers);
    }

    private async initWorkers(numWorkers: number): Promise<void> {
        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker(this.workerUrl, { type: 'module' });

            const initPromise = new Promise<void>((resolve, reject) => {
                const onMessage = (e: MessageEvent) => {
                    if (e.data.type === 'ready') {
                        worker.removeEventListener('message', onMessage);
                        this.setupWorker(worker);
                        resolve();
                    }
                };
                worker.addEventListener('message', onMessage);
                worker.addEventListener('error', (e) => reject(e));
            });

            worker.postMessage({
                type: 'init',
                data: {
                    wasmJsUrl: this.wasmJsUrl,
                    wasmBinaryUrl: this.wasmBinaryUrl,
                    fontBytes: this.fontBytes
                }
            });

            this.workers.push(worker);
            initPromises.push(initPromise);
        }

        await Promise.all(initPromises);
    }

    private setupWorker(worker: Worker) {
        this.available.push(worker);

        worker.addEventListener('message', (e: MessageEvent) => {
            if (e.data.type === 'result') {
                const task = this.workerTasks.get(worker);
                if (task) {
                    this.workerTasks.delete(worker);
                    task.resolve(e.data.data as GlyphResult);
                }

                const next = this.taskQueue.shift();
                if (next) {
                    this.dispatchToWorker(worker, next);
                } else {
                    this.available.push(worker);
                }
            }
        });
    }

    private dispatchToWorker(
        worker: Worker,
        task: {
            charCode: number;
            fontSize: number;
            pixelRange: number;
            glyphType: 'msdf' | 'mtsdf';
            resolve: (result: GlyphResult) => void;
        }
    ) {
        this.workerTasks.set(worker, { charCode: task.charCode, resolve: task.resolve });
        worker.postMessage({
            type: 'generate',
            data: {
                charCode: task.charCode,
                fontSize: task.fontSize,
                pixelRange: task.pixelRange,
                glyphType: task.glyphType
            }
        });
    }

    async generateGlyph(
        charCode: number,
        fontSize: number,
        pixelRange: number,
        glyphType: 'msdf' | 'mtsdf'
    ): Promise<GlyphResult> {
        await this.ready;

        return new Promise((resolve) => {
            const task = { charCode, fontSize, pixelRange, glyphType, resolve };

            const worker = this.available.pop();
            if (worker) {
                this.dispatchToWorker(worker, task);
            } else {
                this.taskQueue.push(task);
            }
        });
    }

    async generateBatch(
        chars: number[],
        fontSize: number,
        pixelRange: number,
        glyphType: 'msdf' | 'mtsdf'
    ): Promise<GlyphResult[]> {
        await this.ready;

        const promises = chars.map(charCode =>
            this.generateGlyph(charCode, fontSize, pixelRange, glyphType)
        );

        return Promise.all(promises);
    }

    get isWorkersOnly(): boolean {
        return this.workersOnly;
    }

    get workerCount(): number {
        return this.workers.length;
    }

    async dispose(): Promise<void> {
        const disposePromises = this.workers.map(worker =>
            new Promise<void>((resolve) => {
                const onMessage = (e: MessageEvent) => {
                    if (e.data.type === 'disposed') {
                        worker.removeEventListener('message', onMessage);
                        worker.terminate();
                        resolve();
                    }
                };
                worker.addEventListener('message', onMessage);
                worker.postMessage({ type: 'dispose' });
            })
        );

        await Promise.all(disposePromises);
        this.workers = [];
        this.available = [];
    }
}
