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
