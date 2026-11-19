/**
 * Lightweight performance instrumentation for the gallery.
 *
 * Every event is kept in a bounded in-memory list; console logging and the
 * "Performance report" panel are opt-in (settings.debugPerf or ?galleryPerf=1).
 */

export interface PerfEvent {
    id: number;
    name: string;
    start: number;
    duration: number;
    detail?: Record<string, unknown>;
}

const MAX_EVENTS = 400;
const events: PerfEvent[] = [];
const marks = new Map<string, number>();
let enabled = false;
let seq = 0;

export function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function setPerfEnabled(value: boolean): void {
    enabled = value;
    if (value) {
        console.info('[Gallery perf] instrumentation enabled');
    }
}

export function isPerfEnabled(): boolean {
    return enabled;
}

function push(name: string, start: number, duration: number, detail?: Record<string, unknown>): void {
    seq += 1;
    const event: PerfEvent = { id: seq, name, start, duration, detail };
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    if (enabled) {
        const fields = detail && Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : '';
        console.debug(`[Gallery perf] ${name}: ${duration.toFixed(1)} ms${fields}`);
    }
}

export function perfMark(name: string, detail?: Record<string, unknown>): number {
    const start = now();
    marks.set(name, start);
    push(`${name}.mark`, start, 0, detail);
    return start;
}

export function perfMeasure(name: string, startOrMark: string | number, detail?: Record<string, unknown>): number {
    const start = typeof startOrMark === 'string' ? (marks.get(startOrMark) ?? now()) : startOrMark;
    const duration = Math.max(0, now() - start);
    push(name, start, duration, detail);
    return duration;
}

export function perfRecord(name: string, duration: number, detail?: Record<string, unknown>): void {
    push(name, now() - duration, duration, detail);
}

export function getPerfEvents(): PerfEvent[] {
    return [...events];
}

export function resetPerf(): void {
    events.length = 0;
    marks.clear();
    seq = 0;
}

export interface PerfSnapshot {
    events: PerfEvent[];
    userAgent: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    generatedAt: string;
    location: string;
}

export function getPerfSnapshot(): PerfSnapshot {
    const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
        events: getPerfEvents(),
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        generatedAt: new Date().toISOString(),
        location: window.location.href,
        ...(perf.memory ? { memory: perf.memory } : {}),
    } as PerfSnapshot;
}

export function formatMs(ms: number): string {
    if (!Number.isFinite(ms)) return '-';
    if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
    if (ms < 1000) return `${ms.toFixed(1)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

export function installPerfConsoleApi(): void {
    (window as unknown as Record<string, unknown>).__galleryPerf = {
        events: getPerfEvents,
        snapshot: getPerfSnapshot,
        reset: resetPerf,
        format: formatMs,
    };
}
