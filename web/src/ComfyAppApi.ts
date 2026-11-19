// ComfyAppApi.ts
// Provides API functions and event listeners for ComfyUI Gallery integration.
// Uses window.comfyAPI.app.app if available, otherwise provides a mock for development.

// Types for event callbacks
type GalleryEventCallback = (event: any) => void;

export const BASE_PATH = getComfyApp() ? window.location.origin : "http://localhost:8188";
export const OPEN_BUTTON_ID = "comfy-ui-gallery-open-button";
export const BASE_Z_INDEX = 3000;

export interface DeleteFailure {
    path: string;
    error: string;
}

export interface DeleteResult {
    deleted: string[];
    failed: DeleteFailure[];
    count: number;
}

export interface AssetActionResult {
    ok: boolean;
    error?: string;
}

export interface ServerPerfRecord {
    label: string;
    ms: number;
    ts?: number;
    timestamp?: number;
    fields?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface ServerPerfResponse {
    records: ServerPerfRecord[];
    scan?: Record<string, unknown>;
    thumbnails?: Record<string, unknown>;
    version?: string;
}

function getComfyApp() {
    try {
        // @ts-ignore
        if (window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app) {
            // @ts-ignore
            return window.comfyAPI.app.app;
        }
    } catch (e) {}
    return null;
}

const mockApi = {
    api: {
        fetchApi: async (url: string, options?: any) => {
            console.log('[MockAPI] fetchApi called:', url, options);
            // Mocked API responses for development
            if (url.startsWith("/Gallery/images")) {
                return fetch("/api.json", {});;
            }
            if (url.startsWith("/Gallery/metadata")) {
                return new Response(JSON.stringify({ metadata: {}, cached: false }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (url.startsWith("/Gallery/perf")) {
                return new Response(JSON.stringify({ records: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (url === "/Gallery/delete") {
                let paths: string[] = [];
                try {
                    const body = options?.body ? JSON.parse(options.body) : {};
                    paths = body.image_paths ?? (body.image_path ? [body.image_path] : []);
                } catch { }
                return new Response(JSON.stringify({ deleted: paths, failed: [], count: paths.length }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (url === "/Gallery/reveal" || url === "/Gallery/open") {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            if (url === "/Gallery/monitor/start") {
                return { ok: true, text: async () => "{\"status\":\"started\"}" };
            }
            if (url === "/Gallery/monitor/stop") {
                return { ok: true, text: async () => "{\"status\":\"stopped\"}" };
            }
            return { ok: true, text: async () => "{}" };
        },
        addEventListener: (event: string, cb: GalleryEventCallback) => {
            console.log(`[MockAPI] addEventListener called for event: ${event}`);
            // No-op in mock
        },
        moveImage: async (sourcePath: string, targetPath: string) => {
            console.log(`[MockAPI] moveImage called: ${sourcePath} -> ${targetPath}`);
            // Simulate success
            return true;
        },
        deleteImage: async (imagePath: string) => {
            console.log(`[MockAPI] deleteImage called: ${imagePath}`);
            // Simulate success
            return true;
        },
    },
    registerExtension: (ext: any) => {
        console.log('[MockAPI] registerExtension called:', ext);
        try {
            ext?.init();
            ext?.nodeCreated();
        } catch (error) {

        }
    }
};

const comfyApp = getComfyApp();
const app = comfyApp ? comfyApp : mockApi;

function normalizeDeleteResult(payload: any, requested: string[], ok: boolean): DeleteResult {
    if (payload && Array.isArray(payload.deleted)) {
        const deleted = payload.deleted as string[];
        const failed = Array.isArray(payload.failed) ? payload.failed as DeleteFailure[] : [];
        return { deleted, failed, count: typeof payload.count === 'number' ? payload.count : deleted.length };
    }
    if (ok) {
        return { deleted: requested, failed: [], count: requested.length };
    }
    return {
        deleted: [],
        failed: requested.map((path) => ({ path, error: 'delete failed' })),
        count: 0,
    };
}

async function postAssetAction(url: string, imagePath: string): Promise<AssetActionResult> {
    try {
        const response = await app.api.fetchApi(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_path: imagePath }),
        });
        let payload: any = undefined;
        try {
            payload = await response.json();
        } catch { }
        if (response.ok && payload?.ok !== false) {
            return { ok: true };
        }
        return {
            ok: false,
            error: payload?.error || `HTTP ${response.status}`,
        };
    } catch (error) {
        return { ok: false, error: String(error) };
    }
}

export const ComfyAppApi = {
    startMonitoring: (relativePath: string, disableLogs?: boolean, usePollingObserver?: boolean, scanExtensions?: string[], deduplicateSymlinks?: boolean, debugPerf?: boolean) =>
        app.api.fetchApi("/Gallery/monitor/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                relative_path: relativePath,
                disable_logs: disableLogs ?? false,
                use_polling_observer: usePollingObserver ?? false,
                scan_extensions: scanExtensions,
                deduplicate_symlinks: deduplicateSymlinks ?? true,
                debug_perf: debugPerf ?? false
            })
        }),
    stopMonitoring: () =>
        app.api.fetchApi("/Gallery/monitor/stop", {
            method: "POST"
        }),
    fetchImages: (relativePath?: string) =>
        app.api.fetchApi(`/Gallery/images?relative_path=${encodeURIComponent(relativePath ?? './')}`, { cache: 'no-store' }),
    fetchMetadata: async (imageUrl: string) => {
        const response = await app.api.fetchApi(`/Gallery/metadata?path=${encodeURIComponent(imageUrl)}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`metadata HTTP ${response.status}`);
        }
        const payload = await response.json();
        return payload?.metadata ?? {};
    },
    fetchPerf: async (): Promise<ServerPerfResponse> => {
        try {
            const response = await app.api.fetchApi('/Gallery/perf', { cache: 'no-store' });
            if (!response.ok) return { records: [] };
            return await response.json();
        } catch {
            return { records: [] };
        }
    },
    resetPerf: async () => {
        try {
            await app.api.fetchApi('/Gallery/perf', { method: 'DELETE' });
        } catch { }
    },
    onFileChange: (cb: GalleryEventCallback) =>
        app.api.addEventListener("Gallery.file_change", cb),
    onUpdate: (cb: GalleryEventCallback) =>
        app.api.addEventListener("Gallery.update", cb),
    onClear: (cb: GalleryEventCallback) =>
        app.api.addEventListener("Gallery.clear", cb),
    registerExtension: (ext: any) =>
        app.registerExtension(ext),
    moveImage: async (sourcePath: string, targetPath: string) => {
        try { 
            console.log("moving image");
            console.log("sourcePath:", sourcePath);
            console.log("targetPath:", targetPath);

            const response = await app.api.fetchApi("/Gallery/move", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source_path: sourcePath, target_path: targetPath })
            });
            if (response.ok) {
                console.log(`Image moved from ${sourcePath} to ${targetPath}`);
                return true;
            } else {
                const errorText = await response.text();
                console.error("Failed to move image:", errorText);
                return false;
            }
        } catch (error) {
            console.error("Error moving image:", error);
            return false;
        }
    },
    deleteImages: async (imagePaths: string[]): Promise<DeleteResult> => {
        if (imagePaths.length === 0) return { deleted: [], failed: [], count: 0 };
        try {
            const body = imagePaths.length === 1
                ? { image_path: imagePaths[0] }
                : { image_paths: imagePaths };
            const response = await app.api.fetchApi("/Gallery/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            let payload: any = undefined;
            try {
                const contentType = response.headers?.get?.('content-type') ?? '';
                if (contentType.includes('application/json')) {
                    payload = await response.json();
                }
            } catch { }
            return normalizeDeleteResult(payload, imagePaths, response.ok);
        } catch (error) {
            console.error("Error deleting images:", error);
            return {
                deleted: [],
                failed: imagePaths.map((path) => ({ path, error: String(error) })),
                count: 0,
            };
        }
    },
    deleteImage: async (imagePath: string) => {
        // Confirmation should be handled in the UI before calling this method
        const result = await ComfyAppApi.deleteImages([imagePath]);
        return result.deleted.includes(imagePath) || (result.deleted.length > 0 && result.failed.length === 0);
    },
    revealAsset: (imagePath: string): Promise<AssetActionResult> =>
        postAssetAction('/Gallery/reveal', imagePath),
    openAsset: (imagePath: string): Promise<AssetActionResult> =>
        postAssetAction('/Gallery/open', imagePath),
    // Settings endpoints
    fetchSettings: async () => {
        try {
            const res = await app.api.fetchApi("/Gallery/settings", { cache: 'no-store' });
            if (res.ok) return await res.json();
        } catch(e) { console.error(e); }
        return {};
    },
    saveSettings: async (settings: any) => {
        try {
            await app.api.fetchApi("/Gallery/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings)
            });
        } catch(e) { console.error(e); }
    },
};
