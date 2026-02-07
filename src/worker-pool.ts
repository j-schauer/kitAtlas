/**
 * Worker pool for parallel glyph generation (Node.js)
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
    workersOnly?: boolean;  // If true, don't generate on main thread
}

export class WorkerPool {
    private workers: Worker[] = [];
    private available: Worker[] = [];
    private pending: PendingTask[] = [];
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
        private wasmPath: string,
        private fontBytes: Uint8Array,
        options: WorkerPoolOptions
    ) {
        this.workersOnly = options.workersOnly ?? false;
        this.ready = this.initWorkers(options.numWorkers);
    }

    private async initWorkers(numWorkers: number): Promise<void> {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const workerPath = join(__dirname, 'worker.js');

        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker(workerPath);

            const initPromise = new Promise<void>((resolve, reject) => {
                const onMessage = (msg: any) => {
                    if (msg.type === 'ready') {
                        worker.off('message', onMessage);
                        this.setupWorker(worker);
                        resolve();
                    }
                };
                worker.on('message', onMessage);
                worker.on('error', reject);
            });

            worker.postMessage({
                type: 'init',
                data: {
                    wasmPath: this.wasmPath,
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

        worker.on('message', (msg: any) => {
            if (msg.type === 'result') {
                const task = this.workerTasks.get(worker);
                if (task) {
                    this.workerTasks.delete(worker);
                    task.resolve(msg.data as GlyphResult);
                }

                // Process next task in queue
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
                worker.once('message', (msg: any) => {
                    if (msg.type === 'disposed') {
                        worker.terminate();
                        resolve();
                    }
                });
                worker.postMessage({ type: 'dispose' });
            })
        );

        await Promise.all(disposePromises);
        this.workers = [];
        this.available = [];
    }
}
