import { startTransition, useEffect, useRef, useState } from 'react';
import { Slider, Tooltip } from 'antd';
import PictureOutlined from '@ant-design/icons/lib/icons/PictureOutlined';
import { useGalleryContext, useGalleryLayout } from './GalleryContext';

/**
 * Header preview-size control. Slider input is coalesced to one update per
 * animation frame; the grid update is a React transition so the slider itself
 * stays responsive. The final size is persisted when the drag completes.
 */
const GallerySizeControl = () => {
    const { settings, setSettings } = useGalleryContext();
    const { effectiveThumbSize, setThumbSizePreview } = useGalleryLayout();
    const [value, setValue] = useState(effectiveThumbSize);
    const frameRef = useRef<number | null>(null);
    const pendingRef = useRef(effectiveThumbSize);

    useEffect(() => {
        setValue(effectiveThumbSize);
    }, [effectiveThumbSize]);

    useEffect(() => () => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
    }, []);

    const applyPreview = (size: number) => {
        pendingRef.current = size;
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            const next = pendingRef.current;
            setValue(next);
            startTransition(() => setThumbSizePreview(next));
        });
    };

    const commit = (size: number) => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
        setValue(size);
        setSettings({ ...settings, thumbSize: size });
        setThumbSizePreview(null);
    };

    return (
        <div
            className="gallery-size-control"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Tooltip title="Preview size">
                <PictureOutlined className="gallery-size-icon" />
            </Tooltip>
            <Slider
                className="gallery-size-slider"
                min={160}
                max={600}
                step={10}
                value={value}
                onChange={(next) => {
                    const size = Array.isArray(next) ? next[0] : next;
                    applyPreview(size);
                }}
                onChangeComplete={(next) => {
                    const size = Array.isArray(next) ? next[0] : next;
                    commit(size);
                }}
                tooltip={{ formatter: (next) => `${next}px` }}
                aria-label="Preview size"
            />
            <span className="gallery-size-value">{value}px</span>
        </div>
    );
};

export default GallerySizeControl;
