import type { FileDetails } from './types';
import { toOutputRelativePath } from './GalleryGraph';

export interface MaskEditorResult {
    ok: boolean;
    error?: string;
}

function outputViewUrl(asset: FileDetails, relativePath: string): string {
    const relative = toOutputRelativePath(asset.url, relativePath);
    const slash = relative.lastIndexOf('/');
    const subfolder = slash >= 0 ? relative.slice(0, slash) : '';
    const filename = slash >= 0 ? relative.slice(slash + 1) : relative;
    const params = new URLSearchParams({
        filename,
        type: 'output',
        subfolder,
    });
    return `/view?${params.toString()}`;
}

function graphApi() {
    const comfy = (window as any).comfyAPI?.app?.app;
    const liteGraph = (window as any).LiteGraph;
    const ComfyApp = (window as any).comfyAPI?.app?.ComfyApp;
    if (!comfy || !liteGraph || !ComfyApp) return null;
    const canvas = comfy.canvas;
    const graphs = [canvas?.subgraph?.graph, canvas?.subgraph, canvas?.graph, comfy.graph];
    const graph = graphs.find((candidate) => candidate && typeof candidate.add === 'function');
    if (!graph) return null;
    return { comfy, liteGraph, ComfyApp, canvas, graph };
}

/**
 * Open ComfyUI's built-in mask editor for a gallery image.
 *
 * The native editor is reliable for a standard LoadImage node, so the image is
 * uploaded into ComfyUI's input directory and a LoadImage node is selected.
 * The gallery modal is closed first because the global mask-editor dialog opens
 * behind it.
 */
export async function openMaskEditor(
    asset: FileDetails,
    relativePath: string,
    closeGallery?: () => void,
): Promise<MaskEditorResult> {
    if (asset.type !== 'image') {
        return { ok: false, error: 'Mask editing is available for images only' };
    }

    const api = graphApi();
    if (!api) {
        return { ok: false, error: 'The built-in ComfyUI mask editor is not available' };
    }

    let node: any = null;
    try {
        const imageResponse = await fetch(outputViewUrl(asset, relativePath));
        if (!imageResponse.ok) {
            throw new Error(`Could not load ${asset.name} (HTTP ${imageResponse.status})`);
        }
        const blob = await imageResponse.blob();

        const form = new FormData();
        form.append('image', blob, asset.name);
        form.append('type', 'input');
        form.append('subfolder', 'gallery_masks');
        const uploadResponse = await fetch('/upload/image', { method: 'POST', body: form });
        if (!uploadResponse.ok) {
            throw new Error(`Could not upload ${asset.name} for mask editing`);
        }
        const uploaded = await uploadResponse.json();
        const filename = uploaded?.name || asset.name;
        const subfolder = uploaded?.subfolder || 'gallery_masks';
        const inputValue = subfolder ? `${subfolder}/${filename}` : filename;
        const inputView = `/view?${new URLSearchParams({
            filename,
            type: 'input',
            subfolder,
        }).toString()}`;

        node = api.liteGraph.createNode('LoadImage');
        if (!node) throw new Error('LoadImage node is not registered');

        const imageWidget = node.widgets?.find((widget: any) => widget.name === 'image');
        if (imageWidget) {
            const values = imageWidget.options?.values;
            if (Array.isArray(values) && !values.includes(inputValue)) {
                try {
                    values.push(inputValue);
                } catch {
                    // Read-only combo is fine.
                }
            }
            imageWidget.value = inputValue;
        }

        const image = new Image();
        image.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error(`Could not load ${asset.name} for the mask editor`));
            image.src = inputView;
        });
        node.imgs = [image];
        node.images = [{ filename, subfolder, type: 'input', url: inputView }];

        api.graph.add(node);
        node.pos = [300, 300];
        node.title = `Mask: ${asset.name}`;
        api.graph.setDirtyCanvas?.(true, true);
        api.graph.change?.();
        api.canvas?.setDirty?.(true, true);
        api.canvas?.selectNode?.(node, false);

        // The global mask editor is behind the gallery modal; close it and let
        // the modal finish hiding before opening the editor.
        closeGallery?.();
        await new Promise((resolve) => window.setTimeout(resolve, 350));

        api.ComfyApp.copyToClipspace(node);
        api.ComfyApp.clipspace_return_node = node;
        api.ComfyApp.open_maskeditor();
        return { ok: true };
    } catch (error) {
        try {
            if (node) api.graph.remove?.(node);
        } catch {
            // Leave the node if the frontend refuses removal.
        }
        return { ok: false, error: String(error) };
    }
}
