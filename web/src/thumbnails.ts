import { useEffect, useState } from 'react';
import { BASE_PATH } from './ComfyAppApi';
import { perfRecord } from './perf';
import type { FileDetails } from './types';

/**
 * Preview loading is intentionally paged: cards enqueue thumbnail requests,
 * only 6 requests are in flight, and the next page starts as slots free up.
 * Full-resolution originals are never requested by the grid.
 */

const MAX_CONCURRENT = 6;
const MAX_CACHE_ENTRIES = 600;

/**
 * Grid thumbnails are requested at one stable width. Card resizing then only
 * scales the already-loaded image instead of triggering a second download for
 * every size bucket. 600 px still covers the maximum card width.
 */
export const GRID_THUMBNAIL_WIDTH = 600;

interface ThumbJob {
    key: string;
    url: string;
    resolve: (src: string) => void;
    reject: (error: Error) => void;
}

const queue: ThumbJob[] = [];
const inflight = new Map<string, Promise<string>>();
const cache = new Map<string, string>();
const failed = new Set<string>();

const stats = {
    requested: 0,
    loaded: 0,
    failed: 0,
    bytes: 0,
    totalMs: 0,
    peakQueue: 0,
};

let active = 0;

export function normalizeThumbWidth(width: number): number {
    const deviceWidth = width * Math.min(window.devicePixelRatio || 1, 2);
    // Quantize so a few card sizes share cache entries.
    const buckets = [200, 300, 400, 600, 800];
    return buckets.find((bucket) => deviceWidth <= bucket) ?? 800;
}

import { assetVersion } from './assetUrls';

export function thumbnailUrl(image: Pick<FileDetails, 'url' | 'timestamp' | 'version'>, width: number): string {
    const w = normalizeThumbWidth(width);
    const version = assetVersion(image);
    return `${BASE_PATH}/Gallery/thumbnail?path=${encodeURIComponent(image.url)}&w=${w}&v=${encodeURIComponent(version)}`;
}

function cacheKey(image: Pick<FileDetails, 'url' | 'timestamp' | 'version'>, width: number): string {
    return `${image.url}|${normalizeThumbWidth(width)}|${assetVersion(image)}`;
}

function trimCache(): void {
    while (cache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        const oldUrl = cache.get(oldestKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        cache.delete(oldestKey);
    }
}

function pump(): void {
    while (active < MAX_CONCURRENT && queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        active += 1;
        stats.peakQueue = Math.max(stats.peakQueue, queue.length + active);
        const started = performance.now();
        fetch(job.url, { credentials: 'same-origin', cache: 'force-cache' })
            .then((response) => {
                const type = response.headers.get('content-type') || '';
                if (!response.ok) throw new Error(`thumbnail HTTP ${response.status}`);
                if (!type.startsWith('image/')) throw new Error(`thumbnail is not an image (${type})`);
                return response.blob();
            })
            .then((blob) => {
                const objectUrl = URL.createObjectURL(blob);
                cache.set(job.key, objectUrl);
                trimCache();
                stats.loaded += 1;
                stats.bytes += blob.size;
                stats.totalMs += performance.now() - started;
                perfRecord('thumbnails.load', performance.now() - started, {
                    sha: job.key.slice(0, 64),
                    bytes: blob.size,
                    active,
                    queued: queue.length,
                });
                job.resolve(objectUrl);
            })
            .catch((error: Error) => {
                failed.add(job.key);
                stats.failed += 1;
                job.reject(error);
            })
            .finally(() => {
                inflight.delete(job.key);
                active -= 1;
                pump();
            });
    }
}

export function getCachedThumbnail(image: Pick<FileDetails, 'url' | 'timestamp' | 'version'>, width: number): string | undefined {
    return cache.get(cacheKey(image, width));
}

export function loadThumbnail(image: Pick<FileDetails, 'url' | 'timestamp' | 'version'>, width: number): Promise<string> {
    const key = cacheKey(image, width);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (failed.has(key)) return Promise.reject(new Error('thumbnail previously failed'));
    const existing = inflight.get(key);
    if (existing) return existing;

    stats.requested += 1;
    const promise = new Promise<string>((resolve, reject) => {
        queue.push({ key, url: thumbnailUrl(image, width), resolve, reject });
        stats.peakQueue = Math.max(stats.peakQueue, queue.length + active);
        pump();
    });
    inflight.set(key, promise);
    return promise;
}

export interface ThumbnailStats {
    requested: number;
    loaded: number;
    failed: number;
    inFlight: number;
    queued: number;
    cacheEntries: number;
    bytes: number;
    avgMs: number;
    peakQueue: number;
}

export function getThumbnailStats(): ThumbnailStats {
    return {
        requested: stats.requested,
        loaded: stats.loaded,
        failed: stats.failed,
        inFlight: active,
        queued: queue.length,
        cacheEntries: cache.size,
        bytes: stats.bytes,
        avgMs: stats.loaded > 0 ? stats.totalMs / stats.loaded : 0,
        peakQueue: stats.peakQueue,
    };
}

export function resetThumbnailStats(): void {
    stats.requested = 0;
    stats.loaded = 0;
    stats.failed = 0;
    stats.bytes = 0;
    stats.totalMs = 0;
    stats.peakQueue = 0;
}

export function clearThumbnailCache(): void {
    for (const objectUrl of cache.values()) URL.revokeObjectURL(objectUrl);
    cache.clear();
    failed.clear();
    inflight.clear();
    queue.length = 0;
    resetThumbnailStats();
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export type ThumbnailState = 'loading' | 'loaded' | 'error';

/**
 * Card-level thumbnail loader. The queue enforces concurrency; this hook only
 * tracks the state of one asset and falls back to the original on error.
 */
export function useThumbnail(
    image: Pick<FileDetails, 'url' | 'timestamp' | 'version'>,
    width: number,
    enabled: boolean = true
): {
    src: string | undefined;
    state: ThumbnailState;
} {
    const normalizedWidth = normalizeThumbWidth(width);
    const initial = enabled ? getCachedThumbnail(image, normalizedWidth) : undefined;
    const [src, setSrc] = useState<string | undefined>(initial);
    const [state, setState] = useState<ThumbnailState>(enabled ? (initial ? 'loaded' : 'loading') : 'error');

    useEffect(() => {
        let alive = true;
        if (!enabled) {
            setSrc(undefined);
            setState('error');
            return () => { alive = false; };
        }
        const cached = getCachedThumbnail(image, normalizedWidth);
        if (cached) {
            setSrc(cached);
            setState('loaded');
            return () => { alive = false; };
        }
        setSrc(undefined);
        setState('loading');
        loadThumbnail(image, normalizedWidth)
            .then((objectUrl) => {
                if (!alive) return;
                setSrc(objectUrl);
                setState('loaded');
            })
            .catch(() => {
                if (!alive) return;
                setState('error');
            });
        return () => { alive = false; };
        // Only the normalized request width matters; resizing within the same
        // bucket must not restart thumbnail loading.
    }, [image.url, image.timestamp, image.version, normalizedWidth, enabled]);

    return { src, state };
}
