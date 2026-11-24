import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Segmented, Switch, Tooltip } from 'antd';
import CloseOutlined from '@ant-design/icons/lib/icons/CloseOutlined';
import ColumnWidthOutlined from '@ant-design/icons/lib/icons/ColumnWidthOutlined';
import ColumnHeightOutlined from '@ant-design/icons/lib/icons/ColumnHeightOutlined';
import type { FileDetails } from './types';
import { assetUrl } from './assetUrls';
import { galleryThemeClass } from './theme';

interface GalleryComparisonProps {
    left: FileDetails;
    right: FileDetails;
    onClose: () => void;
    dark: boolean;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const ComparisonMedia = ({ asset }: { asset: FileDetails }) => {
    if (asset.type === 'media') {
        return (
            <video
                className="gallery-compare-media"
                src={assetUrl(asset)}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                draggable={false}
            />
        );
    }
    return (
        <img
            className="gallery-compare-media"
            src={assetUrl(asset)}
            alt={asset.name}
            draggable={false}
        />
    );
};

const GalleryComparison = ({ left, right, onClose, dark }: GalleryComparisonProps) => {
    const [compare, setCompare] = useState(true);
    const [fade, setFade] = useState(false);
    const [axis, setAxis] = useState<'x' | 'y'>('x');
    const [ratio, setRatio] = useState(0.5);
    const stageRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                onClose();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                // The comparison viewer is read-only; never delete underneath it.
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [onClose]);

    const updateFromPointer = useCallback((clientX: number, clientY: number) => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        if (fade) {
            setRatio(clamp01((clientX - rect.left) / Math.max(1, rect.width)));
            return;
        }
        if (axis === 'x') {
            setRatio(clamp01((clientX - rect.left) / Math.max(1, rect.width)));
        } else {
            setRatio(clamp01((clientY - rect.top) / Math.max(1, rect.height)));
        }
    }, [axis, fade]);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!compare) return;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        updateFromPointer(event.clientX, event.clientY);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current || !compare) return;
        updateFromPointer(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
        draggingRef.current = false;
    };

    const clipPath = axis === 'x'
        ? `inset(0 ${(1 - ratio) * 100}% 0 0)`
        : `inset(0 0 ${(1 - ratio) * 100}% 0)`;

    return (
        <div
            className={`gallery-comparison-root ${galleryThemeClass(dark)}`}
            role="dialog"
            aria-modal="true"
            aria-label="Compare assets"
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="gallery-compare-topbar" onPointerDown={(event) => event.stopPropagation()}>
                <div className="gallery-compare-names">
                    <span title={left.name}>{left.name}</span>
                    <span className="gallery-compare-vs">vs</span>
                    <span title={right.name}>{right.name}</span>
                </div>
                <div className="gallery-compare-controls">
                    <Tooltip title="Direction of the wipe divider">
                        <Segmented
                            size="small"
                            value={axis}
                            disabled={!compare || fade}
                            onChange={(value) => setAxis(value as 'x' | 'y')}
                            options={[
                                { value: 'x', icon: <ColumnWidthOutlined />, label: 'Horizontal' },
                                { value: 'y', icon: <ColumnHeightOutlined />, label: 'Vertical' },
                            ]}
                        />
                    </Tooltip>
                    <label className="gallery-compare-switch">
                        <span>Compare</span>
                        <Switch size="small" checked={compare} onChange={setCompare} />
                    </label>
                    <label className="gallery-compare-switch">
                        <span>Fade</span>
                        <Switch
                            size="small"
                            checked={fade}
                            disabled={!compare}
                            onChange={(checked) => setFade(checked)}
                        />
                    </label>
                    <span className="gallery-compare-value">{Math.round(ratio * 100)}%</span>
                    <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        onClick={onClose}
                        aria-label="Close comparison"
                    />
                </div>
            </div>

            {compare ? (
                <div
                    ref={stageRef}
                    className={`gallery-compare-stage${fade ? ' is-fade' : ''}`}
                    style={{ cursor: fade ? 'ew-resize' : axis === 'x' ? 'col-resize' : 'row-resize' }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    <div className="gallery-compare-base">
                        <ComparisonMedia asset={right} />
                    </div>
                    <div
                        className="gallery-compare-overlay"
                        style={fade ? { opacity: ratio } : { clipPath }}
                    >
                        <ComparisonMedia asset={left} />
                    </div>
                    {!fade && (
                        <div
                            className={`gallery-compare-divider gallery-compare-divider-${axis}`}
                            style={axis === 'x' ? { left: `${ratio * 100}%` } : { top: `${ratio * 100}%` }}
                        >
                            <span className="gallery-compare-handle" />
                        </div>
                    )}
                </div>
            ) : (
                <div className="gallery-compare-side-by-side">
                    <div className="gallery-compare-pane">
                        <ComparisonMedia asset={left} />
                    </div>
                    <div className="gallery-compare-pane">
                        <ComparisonMedia asset={right} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default GalleryComparison;
