import { useEffect, useState } from 'react';
import { Slider, Tooltip } from 'antd';
import PictureOutlined from '@ant-design/icons/lib/icons/PictureOutlined';
import { useGalleryContext } from './GalleryContext';

/**
 * Bottom-left preview-size control. Dragging updates the grid immediately via
 * a preview value; the new size is persisted once the drag completes.
 */
const GallerySizeControl = () => {
    const { settings, setSettings, effectiveThumbSize, setThumbSizePreview } = useGalleryContext();
    const [value, setValue] = useState(effectiveThumbSize);

    useEffect(() => {
        setValue(effectiveThumbSize);
    }, [effectiveThumbSize]);

    const commit = (next: number) => {
        setSettings({ ...settings, thumbSize: next });
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
                min={160}
                max={600}
                step={10}
                value={value}
                onChange={(next) => {
                    const size = Array.isArray(next) ? next[0] : next;
                    setValue(size);
                    setThumbSizePreview(size);
                }}
                onChangeComplete={(next) => {
                    const size = Array.isArray(next) ? next[0] : next;
                    commit(size);
                }}
                tooltip={{ formatter: (next) => `${next}px` }}
                aria-label="Preview size"
                style={{ width: 160, margin: 0 }}
            />
            <span className="gallery-size-value">{value}px</span>
        </div>
    );
};

export default GallerySizeControl;
