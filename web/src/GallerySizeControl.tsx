import { useEffect, useRef, useState } from 'react';
import { Slider, Tooltip } from 'antd';
import PictureOutlined from '@ant-design/icons/lib/icons/PictureOutlined';
import { useGalleryContext } from './GalleryContext';

/**
 * Header preview-size control. During a drag it only updates CSS variables on
 * the grid, so the browser reflows natively without React re-rendering cards.
 * The final size is persisted when the drag completes.
 */
const GallerySizeControl = () => {
    const { settings, setSettings } = useGalleryContext();
    const [value, setValue] = useState(settings.thumbSize ?? 350);
    const frameRef = useRef<number | null>(null);
    const pendingRef = useRef(value);

    useEffect(() => {
        setValue(settings.thumbSize ?? 350);
    }, [settings.thumbSize]);

    useEffect(() => () => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
    }, []);

    const applySize = (size: number) => {
        const grid = document.querySelector<HTMLElement>('.gallery-grid-body');
        if (grid) {
            grid.style.setProperty('--gallery-card-width', `${size}px`);
            grid.style.setProperty('--gallery-card-height', `${Math.round(size * (450 / 350))}px`);
        }
        setValue(size);
    };

    const schedule = (size: number) => {
        pendingRef.current = size;
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            applySize(pendingRef.current);
        });
    };

    const commit = (size: number) => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
        applySize(size);
        setSettings({ ...settings, thumbSize: size });
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
                    schedule(size);
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
