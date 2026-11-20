import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export interface MarqueeRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface BoxSelectionOptions {
    containerRef: RefObject<HTMLElement | null>;
    selected: string[];
    onChange: (urls: string[]) => void;
    onClear?: () => void;
    enabled?: boolean;
    itemSelector?: string;
}

interface DragState {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    base: Set<string>;
    additive: boolean;
    moved: boolean;
    pointerId: number;
    lastKey: string;
}

const DRAG_THRESHOLD = 4;
const EDGE = 64;
const SCROLL_STEP = 28;

function intersects(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Box-drag selection over the virtualized grid.
 *
 * Starts only on the background (not on a card/button/input), draws a marquee
 * in container coordinates, selects mounted cards intersecting it, supports
 * Ctrl/Cmd as additive, and auto-scrolls the gallery scroller near edges.
 */
export function useBoxSelection({
    containerRef,
    selected,
    onChange,
    onClear,
    enabled = true,
    itemSelector = '.image-card[data-asset-url]',
}: BoxSelectionOptions) {
    const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
    const [dragging, setDragging] = useState(false);
    const selectedRef = useRef(selected);
    const onChangeRef = useRef(onChange);
    const onClearRef = useRef(onClear);
    const dragRef = useRef<DragState | null>(null);
    const scrollTimerRef = useRef<number | null>(null);
    const suppressClickRef = useRef(false);

    useEffect(() => { selectedRef.current = selected; }, [selected]);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    useEffect(() => { onClearRef.current = onClear; }, [onClear]);

    const stopScrolling = useCallback(() => {
        if (scrollTimerRef.current !== null) {
            window.clearInterval(scrollTimerRef.current);
            scrollTimerRef.current = null;
        }
    }, []);

    const update = useCallback((clientX: number, clientY: number) => {
        const container = containerRef.current;
        const drag = dragRef.current;
        if (!container || !drag) return;
        const boxRect = container.getBoundingClientRect();
        const left = Math.min(drag.startX, clientX);
        const top = Math.min(drag.startY, clientY);
        const right = Math.max(drag.startX, clientX);
        const bottom = Math.max(drag.startY, clientY);
        const moved = Math.abs(clientX - drag.startX) > DRAG_THRESHOLD || Math.abs(clientY - drag.startY) > DRAG_THRESHOLD;
        if (!moved && !drag.moved) {
            setMarquee({
                left: left - boxRect.left,
                top: top - boxRect.top,
                width: 0,
                height: 0,
            });
            return;
        }
        drag.moved = true;
        setMarquee({
            left: left - boxRect.left,
            top: top - boxRect.top,
            width: right - left,
            height: bottom - top,
        });

        const selectionRect = { left, top, right, bottom };
        const next = new Set(drag.base);
        container.querySelectorAll<HTMLElement>(itemSelector).forEach((element) => {
            const url = element.dataset.assetUrl;
            if (!url) return;
            if (intersects(element.getBoundingClientRect(), selectionRect)) {
                next.add(url);
            }
        });
        const nextArray = Array.from(next);
        const key = nextArray.join('\u0000');
        if (key !== drag.lastKey) {
            drag.lastKey = key;
            onChangeRef.current(nextArray);
        }
    }, [containerRef, itemSelector]);

    const scrollParent = useCallback((): HTMLElement | null => {
        const container = containerRef.current;
        if (!container) return null;
        const scroller = container.querySelector<HTMLElement>('.gallery-scroll')
            ?? container.querySelector<HTMLElement>('.grid-element');
        if (scroller && scroller.scrollHeight > scroller.clientHeight) return scroller;
        return null;
    }, [containerRef]);

    const startAutoScroll = useCallback((drag: DragState) => {
        stopScrolling();
        scrollTimerRef.current = window.setInterval(() => {
            if (!dragRef.current) return;
            const container = containerRef.current;
            const scroller = scrollParent();
            if (!container || !scroller) return;
            const boxRect = container.getBoundingClientRect();
            let delta = 0;
            if (drag.lastY < boxRect.top + EDGE) {
                delta = -SCROLL_STEP;
            } else if (drag.lastY > boxRect.bottom - EDGE) {
                delta = SCROLL_STEP;
            }
            if (delta !== 0) {
                const before = scroller.scrollTop;
                scroller.scrollTop += delta;
                if (scroller.scrollTop !== before) {
                    update(drag.lastX, drag.lastY);
                }
            }
        }, 60);
    }, [containerRef, scrollParent, stopScrolling, update]);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || event.button !== 0 || event.isPrimary === false) return;
        const target = event.target as HTMLElement;
        if (target.closest(itemSelector)) return;
        if (target.closest('button, a, input, textarea, select, .ant-tree, .gallery-selection-toolbar, .gallery-size-control, .ant-image-preview-root')) return;
        const container = containerRef.current;
        if (!container) return;

        event.preventDefault();
        event.stopPropagation();
        const additive = event.ctrlKey || event.metaKey;
        const drag: DragState = {
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            base: new Set(additive ? selectedRef.current : []),
            additive,
            moved: false,
            pointerId: event.pointerId,
            lastKey: '',
        };
        dragRef.current = drag;
        setDragging(true);
        setMarquee({ left: event.clientX - container.getBoundingClientRect().left, top: event.clientY - container.getBoundingClientRect().top, width: 0, height: 0 });
        startAutoScroll(drag);

        const onMove = (moveEvent: PointerEvent) => {
            const current = dragRef.current;
            if (!current || moveEvent.pointerId !== current.pointerId) return;
            current.lastX = moveEvent.clientX;
            current.lastY = moveEvent.clientY;
            update(moveEvent.clientX, moveEvent.clientY);
        };

        const onUp = (upEvent: PointerEvent) => {
            const current = dragRef.current;
            stopScrolling();
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            dragRef.current = null;
            setDragging(false);
            setMarquee(null);
            if (!current) return;
            if (current.moved) {
                suppressClickRef.current = true;
                window.setTimeout(() => { suppressClickRef.current = false; }, 160);
            } else if (!current.additive) {
                onClearRef.current?.();
            }
            if (upEvent.pointerId !== current.pointerId) return;
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }, [containerRef, enabled, itemSelector, startAutoScroll, stopScrolling, update]);

    useEffect(() => () => stopScrolling(), [stopScrolling]);

    return {
        marquee,
        dragging,
        suppressClickRef,
        onPointerDown,
    };
}
