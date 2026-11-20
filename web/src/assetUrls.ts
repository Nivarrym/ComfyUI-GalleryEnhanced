import { BASE_PATH } from './ComfyAppApi';
import type { FileDetails } from './types';

type AssetRef = Pick<FileDetails, 'url' | 'timestamp' | 'version'>;

/**
 * Stable cache-busting token for one concrete file revision. ComfyUI resets
 * output numbering when the output folder becomes empty, so a newly generated
 * file can reuse an old URL. The scanner supplies mtime_ns + size; the timestamp
 * fallback keeps older cached listings working.
 */
export function assetVersion(image: AssetRef): string {
    if (image.version) return image.version;
    return String(Math.round((image.timestamp || 0) * 1000));
}

/** Original asset URL with a per-revision query parameter. */
export function assetUrl(image: AssetRef): string {
    const base = `${BASE_PATH}${image.url}`;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}v=${encodeURIComponent(assetVersion(image))}`;
}
