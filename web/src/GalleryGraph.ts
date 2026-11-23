import type { FileDetails } from './types';

export type GalleryGraphAssetType = 'image' | 'media' | 'audio';

export interface GalleryGraphImage {
    url: string;
    name: string;
    type: GalleryGraphAssetType;
}

export interface GalleryGraphResult {
    ok: boolean;
    added: number;
    error?: string;
}

const NODE_CONFIG: Record<GalleryGraphAssetType, { type: string; widget: string }> = {
    image: { type: 'LoadImageFromGallery', widget: 'image' },
    media: { type: 'LoadVideoFromGallery', widget: 'video' },
    audio: { type: 'LoadAudioFromGallery', widget: 'audio' },
};
const STATIC_PREFIX = '/static_gallery/';

/**
 * Convert a gallery URL (relative to the currently selected gallery root) to a
 * path relative to ComfyUI's output directory, which is what the Load Image From
 * Gallery node stores in its combo widget.
 */
export function toOutputRelativePath(imageUrl: string, relativePath: string): string {
    let relative = decodeURIComponent(imageUrl.split('?')[0]);
    if (relative.startsWith(STATIC_PREFIX)) {
        relative = relative.slice(STATIC_PREFIX.length);
    } else {
        relative = relative.replace(/^\/+/, '');
    }

    let root = (relativePath || './').replace(/\\/g, '/').trim();
    root = root.replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (root && root !== '.') {
        relative = `${root}/${relative}`;
    }
    return relative.replace(/\/+/g, '/').replace(/^\/+/, '');
}

function getGraphApi() {
    const comfy = (window as any).comfyAPI?.app?.app ?? (window as any).app;
    const liteGraph = (window as any).LiteGraph;
    if (!comfy || !liteGraph) return null;

    const canvas = comfy.canvas;
    const graph = canvas?.graph ?? comfy.graph;
    if (!graph || typeof graph.add !== 'function') return null;
    return { comfy, liteGraph, canvas, graph };
}

function graphInsertionPoint(canvas: any): [number, number] {    try {
        const element = canvas?.canvas;
        if (element && typeof canvas.convertOffsetToCanvas === 'function') {
            const rect = element.getBoundingClientRect();
            const point = canvas.convertOffsetToCanvas([rect.width / 2, rect.height / 2]);
            if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
                return [point[0], point[1]];
            }
        }
    } catch {
        // Fall through to the last mouse position.
    }
    if (canvas?.graph_mouse && Array.isArray(canvas.graph_mouse)) {
        return [canvas.graph_mouse[0], canvas.graph_mouse[1]];
    }
    return [200, 200];
}

function findFreeInsertionPoint(
    graph: any,
    start: [number, number],
    count: number,
    width: number,
    height: number,
): [number, number] {
    const existing = graph?._nodes ?? graph?.nodes ?? [];
    let x = start[0];
    const y = start[1];
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const positions = Array.from({ length: count }, (_, index) => [
            x + (index % 3) * (width + 28),
            y + Math.floor(index / 3) * (height + 28),
        ]);
        const collides = existing.some((node: any) => {
            if (!Array.isArray(node?.pos)) return false;
            const nodeWidth = node.size?.[0] ?? width;
            const nodeHeight = node.size?.[1] ?? height;
            return positions.some(([px, py]) => (
                Math.abs(node.pos[0] - px) < nodeWidth + 20
                && Math.abs(node.pos[1] - py) < nodeHeight + 20
            ));
        });
        if (!collides) return [x, y];
        x += width + 28;
    }
    return [x, y];
}

/**
 * Add one Load Image From Gallery node per image to the graph that is currently
 * active (including subgraphs). Returns a partial-success result when some nodes
 * could not be created.
 */
export function addGalleryImagesToGraph(
    images: GalleryGraphImage[],
    relativePath: string,
): GalleryGraphResult {
    if (images.length === 0) {
        return { ok: false, added: 0, error: 'No images selected' };
    }

    const api = getGraphApi();
    if (!api) {
        return {
            ok: false,
            added: 0,
            error: 'ComfyUI graph API is unavailable. Reload ComfyUI and try again.',
        };
    }

    const [baseX, baseY] = findFreeInsertionPoint(
        api.graph,
        graphInsertionPoint(api.canvas),
        images.length,
        320,
        160,
    );
    let added = 0;
    const failures: string[] = [];

    images.forEach((image, index) => {
        const config = NODE_CONFIG[image.type];
        if (!config) {
            failures.push(`Unsupported gallery asset type: ${image.type}`);
            return;
        }
        let node: any = null;
        try {
            node = api.liteGraph.createNode(config.type);
        } catch (error) {
            failures.push(String(error));
            return;
        }
        if (!node) {
            failures.push(`Node type ${config.type} is not registered`);
            return;
        }

        try {
            api.graph.add(node);

            const imagePath = toOutputRelativePath(image.url, relativePath);
            const widget = node.widgets?.find((item: any) => item.name === config.widget);
            if (widget) {
                const values = widget.options?.values;
                if (Array.isArray(values) && !values.includes(imagePath)) {
                    try {
                        values.push(imagePath);
                    } catch {
                        // A read-only combo still accepts the current value.
                    }
                }
                widget.value = imagePath;
            }

            const width = node.size?.[0] ?? 320;
            const height = node.size?.[1] ?? 120;
            node.title = image.name;
            node.pos = [
                baseX + (index % 3) * (width + 28),
                baseY + Math.floor(index / 3) * (height + 28),
            ];
            added += 1;
        } catch (error) {
            try {
                api.graph.remove(node);
            } catch {
                // Ignore cleanup failures.
            }
            failures.push(String(error));
        }
    });

    try {
        api.graph.setDirtyCanvas?.(true, true);
        api.canvas?.setDirty?.(true, true);
    } catch {
        // The graph still contains the nodes even if a redraw request fails.
    }

    if (added === 0) {
        return {
            ok: false,
            added,
            error: failures[0] || 'Could not create a Load Image From Gallery node',
        };
    }
    return { ok: true, added };
}

export function galleryImagesFromSelection(images: FileDetails[], selectedUrls: string[]): GalleryGraphImage[] {
    const byUrl = new Map(images.map((image) => [image.url, image]));
    return selectedUrls
        .map((url) => byUrl.get(url))
        .filter((image): image is FileDetails => !!image && (
            image.type === 'image' || image.type === 'media' || image.type === 'audio'
        ))
        .map((image) => ({
            url: image.url,
            name: image.name,
            type: image.type as GalleryGraphAssetType,
        }));
}
