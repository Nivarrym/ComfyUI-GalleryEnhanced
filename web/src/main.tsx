import { createRoot } from 'react-dom/client'
import Gallery from './Gallery.tsx'
import { DEFAULT_SETTINGS } from './GalleryContext.tsx';
import { ComfyAppApi, OPEN_BUTTON_ID } from './ComfyAppApi.ts';
import { installPerfConsoleApi, perfMark, perfMeasure, setPerfEnabled } from './perf';
import galleryCss from './gallery.css?inline';

// The pack is loaded by ComfyUI as an ES module, so attach the stylesheet
// ourselves instead of relying on an index.html <link>.
if (!document.getElementById('comfy-ui-gallery-styles')) {
    const style = document.createElement('style');
    style.id = 'comfy-ui-gallery-styles';
    style.textContent = galleryCss;
    document.head.appendChild(style);
}

installPerfConsoleApi();

function waitForElement(selectorOrSelectors: string | string[], delay = 500, timeout = 10000): Promise<Element | null> {
    return new Promise((resolve) => {
        const selectors = Array.isArray(selectorOrSelectors) ? selectorOrSelectors : [selectorOrSelectors];

        let observer: MutationObserver | null = null;
        let graceTimeoutId: any = null;
        let maxTimeoutId: any = null;
        let bestMatch: { el: Element, index: number } | null = null;

        const cleanup = () => {
            if (observer) observer.disconnect();
            if (graceTimeoutId) clearTimeout(graceTimeoutId);
            if (maxTimeoutId) clearTimeout(maxTimeoutId);
        };

        const finish = (el: Element | null) => {
            cleanup();
            resolve(el);
        };

        // 1. Set Global Timeout (Max Time)
        maxTimeoutId = setTimeout(() => {
            if (bestMatch) {
                console.warn("Gallery: WaitForElement timeout reached, returning lower priority match.");
                finish(bestMatch.el);
            } else {
                console.warn("Gallery: WaitForElement timeout reached, no element found.");
                finish(null);
            }
        }, timeout);

        // 2. Logic to check the DOM
        const check = () => {
            for (let i = 0; i < selectors.length; i++) {
                const selector = selectors[i];
                const el = document.querySelector(selector);

                if (el) {
                    // Highest priority: resolve immediately.
                    if (i === 0) {
                        finish(el);
                        return;
                    }

                    // Lower priority: give the higher-priority selector a short grace period.
                    if (graceTimeoutId) {
                        if (bestMatch && i < bestMatch.index) {
                            bestMatch = { el, index: i };
                        }
                    } else {
                        bestMatch = { el, index: i };
                        graceTimeoutId = setTimeout(() => {
                            if (bestMatch) finish(bestMatch.el);
                        }, delay);
                    }
                    return;
                }
            }
        };

        // 3. Initial Check
        check();

        // 4. Observe DOM changes
        observer = new MutationObserver(() => {
            check();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

function galleryViewUrl(value: string): string {
    const raw = String(value || '');
    const normalized = raw
        .replace(/\\/g, '/')
        .replace(/\s*\[(?:input|output|temp)\]\s*$/i, '')
        .replace(/^\/+/, '');
    const annotation = /\[(input|output|temp)\]\s*$/i.exec(raw);
    const type = annotation ? annotation[1].toLowerCase() : 'output';
    const slash = normalized.lastIndexOf('/');
    const subfolder = slash >= 0 ? normalized.slice(0, slash) : '';
    const filename = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const params = new URLSearchParams({
        filename,
        type,
        subfolder,
        t: String(Date.now()),
    });
    return `/view?${params.toString()}`;
}

function galleryImageDescriptor(value: string) {
    const raw = String(value || '');
    const normalized = raw
        .replace(/\\/g, '/')
        .replace(/\s*\[(?:input|output|temp)\]\s*$/i, '')
        .replace(/^\/+/, '');
    const annotation = /\[(input|output|temp)\]\s*$/i.exec(raw);
    const slash = normalized.lastIndexOf('/');
    return {
        filename: slash >= 0 ? normalized.slice(slash + 1) : normalized,
        subfolder: slash >= 0 ? normalized.slice(0, slash) : '',
        type: annotation ? annotation[1].toLowerCase() : 'output',
        url: galleryViewUrl(value),
    };
}

function attachGalleryImagePreview(node: any) {
    if (node.__galleryImagePreviewInstalled) return;
    node.__galleryImagePreviewInstalled = true;

    const imageWidget = node.widgets?.find((widget: any) => widget.name === 'image');
    if (!imageWidget) return;

    // Use LiteGraph's native image preview fields. The old custom DOM preview
    // produced a second image in addition to the standard node preview.
    const image = new Image();
    image.decoding = 'async';

    let lastValue = '';
    const update = (force = false) => {
        const value = String(imageWidget.value || '');
        if (!force && value === lastValue) return;
        lastValue = value;
        if (!value) {
            node.imgs = [];
            node.images = [];
            node.previewMediaType = undefined;
            node.setDirtyCanvas?.(true, true);
            return;
        }
        const src = galleryViewUrl(value);
        node.images = [galleryImageDescriptor(value)];
        node.previewMediaType = 'image';
        image.onload = () => {
            // These are the standard LoadImage fields consumed by the built-in
            // mask editor, image menu and LiteGraph preview.
            node.imgs = [image];
            node.imageIndex = 0;
            node.setDirtyCanvas?.(true, true);
        };
        image.src = src;
    };

    const originalCallback = imageWidget.callback;
    imageWidget.callback = function (...args: any[]) {
        const result = originalCallback?.apply(this, args);
        update();
        return result;
    };

    const originalConfigure = node.onConfigure;
    node.onConfigure = function (...args: any[]) {
        const result = originalConfigure?.apply(this, args);
        update(true);
        return result;
    };

    const originalDraw = node.onDrawForeground;
    node.onDrawForeground = function (...args: any[]) {
        const result = originalDraw?.apply(this, args);
        // Catches values assigned directly by Add to Graph or by undo/redo.
        update();
        return result;
    };

    update(true);
    try {
        node.setSize([
            Math.max(node.size?.[0] ?? 320, 320),
            Math.max(node.size?.[1] ?? 120, 300),
        ]);
    } catch {
        // The native preview still works if setSize is unavailable.
    }
}

(window as any).__galleryAttachImagePreview = attachGalleryImagePreview;

ComfyAppApi.registerExtension({
    name: "Gallery",
    async init() {
        (async () => {
            const initStart = perfMark('extension.init');

            let settings = DEFAULT_SETTINGS;
            try {
                const raw = localStorage.getItem('comfy-ui-gallery-settings');
                if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
            } catch { }

            const params = new URLSearchParams(window.location.search);
            setPerfEnabled(!!settings.debugPerf || params.get('galleryPerf') === '1');

            // Define the priority list of selectors to look for
            const potentialSelectors = [
                settings.buttonBoxQuery,
                "#pv_id_28_content > div > div",
                DEFAULT_SETTINGS.buttonBoxQuery,
                "div.workflow-tabs-container div div.workflow-tabs-container", // Newer ComfyUI
            ].filter((s): s is string => !!s && s.trim().length > 0); // Remove empty/null strings

            console.log("Gallery: Waiting for UI to load...");

            // Wait until one of the selectors exists in the DOM
            const waitStart = perfMark('waitForElement.start');
            const targetElement = await waitForElement(potentialSelectors);
            perfMeasure('waitForElement', waitStart, { found: !!targetElement });

            console.log("Gallery: UI target found:", targetElement);

            if (!targetElement) {
                console.error('Gallery: Could not find element to inject the button.');
                return;
            }

            const box = document.createElement("div");
            targetElement.appendChild(box);

            const renderStart = perfMark('gallery.mount.start');
            createRoot(box).render(
                <Main />,
            );
            perfMeasure('gallery.mount', renderStart);
            perfMeasure('extension.init', initStart);
        })();
    },
    async nodeCreated(node: any) {
        try {
            if (node.comfyClass === "LoadImageFromGallery" || node.type === "LoadImageFromGallery") {
                attachGalleryImagePreview(node);
            }
            if (node.comfyClass === "GalleryNode") {
                node.addWidget("button", "Open Gallery", null, () => {
                    try {
                        let settings = DEFAULT_SETTINGS;
                        try {
                            const raw = localStorage.getItem('comfy-ui-gallery-settings');
                            if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
                        } catch { }
                        if (settings.galleryShortcut) {
                            document.getElementById(OPEN_BUTTON_ID)?.click();
                        }
                    } catch (error) {

                    }
                });
            }
        } catch (error) {

        }
    },
});

function Main() {
    return <Gallery />;
}
