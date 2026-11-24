import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Segmented, Select, Switch, Tooltip } from 'antd';
import CloseOutlined from '@ant-design/icons/lib/icons/CloseOutlined';
import SwapOutlined from '@ant-design/icons/lib/icons/SwapOutlined';
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

type Size = { width: number; height: number };
type FitMode = 'fit' | 'fill' | 'stretch' | 'original' | 'match-width' | 'match-height';
type Box = { left: number; top: number; width: number; height: number };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Fade uses a fixed 360 px drag range regardless of viewport width, so the
// user never has to drag from one screen edge to the other.
const FADE_DRAG_RANGE = 360;

const FIT_OPTIONS: { value: FitMode; label: string }[] = [
    { value: 'fit', label: 'Scale B to fit A' },
    { value: 'fill', label: 'Scale B to fill A' },
    { value: 'stretch', label: 'Stretch B to A' },
    { value: 'original', label: 'Original B size' },
    { value: 'match-width', label: 'Match B width to A' },
    { value: 'match-height', label: 'Match B height to A' },
];

const ANCHORS = [
    { x: 0, y: 0, label: 'Top left' },
    { x: 0.5, y: 0, label: 'Top center' },
    { x: 1, y: 0, label: 'Top right' },
    { x: 0, y: 0.5, label: 'Middle left' },
    { x: 0.5, y: 0.5, label: 'Center' },
    { x: 1, y: 0.5, label: 'Middle right' },
    { x: 0, y: 1, label: 'Bottom left' },
    { x: 0.5, y: 1, label: 'Bottom center' },
    { x: 1, y: 1, label: 'Bottom right' },
];

const contain = (source: Size, width: number, height: number): Size => {
    if (!source.width || !source.height) return { width: 0, height: 0 };
    const scale = Math.min(width / source.width, height / source.height);
    return { width: source.width * scale, height: source.height * scale };
};

const cover = (source: Size, width: number, height: number): Size => {
    if (!source.width || !source.height) return { width: 0, height: 0 };
    const scale = Math.max(width / source.width, height / source.height);
    return { width: source.width * scale, height: source.height * scale };
};

const ComparisonMedia = ({
    asset,
    style,
    onSize,
    positioned = false,
}: {
    asset: FileDetails;
    style?: React.CSSProperties;
    onSize?: (size: Size) => void;
    positioned?: boolean;
}) => {
    const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        onSize?.({ width: image.naturalWidth, height: image.naturalHeight });
    };
    const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        onSize?.({ width: video.videoWidth, height: video.videoHeight });
    };

    if (asset.type === 'media') {
        return (
            <video
                className={`gallery-compare-media${positioned ? ' gallery-compare-media-positioned' : ''}`}
                style={style}
                src={assetUrl(asset)}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                draggable={false}
                onLoadedMetadata={handleVideoMetadata}
            />
        );
    }
    return (
        <img
            className={`gallery-compare-media${positioned ? ' gallery-compare-media-positioned' : ''}`}
            style={style}
            src={assetUrl(asset)}
            alt={asset.name}
            draggable={false}
            onLoad={handleImageLoad}
        />
    );
};

const GalleryComparison = ({ left, right, onClose, dark }: GalleryComparisonProps) => {
    const [assetA, setAssetA] = useState(left);
    const [assetB, setAssetB] = useState(right);
    const [compare, setCompare] = useState(true);
    const [fade, setFade] = useState(false);
    const [axis, setAxis] = useState<'x' | 'y'>('x');
    const [fitMode, setFitMode] = useState<FitMode>('fit');
    const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 });
    const [ratio, setRatio] = useState(0.5);
    const [leftSize, setLeftSize] = useState<Size | null>(null);
    const [rightSize, setRightSize] = useState<Size | null>(null);
    const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
    const stageRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const fadeDragRef = useRef<{ startX: number; startRatio: number } | null>(null);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                onClose();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [onClose]);

    useEffect(() => {
        setAssetA(left);
        setAssetB(right);
        setLeftSize(null);
        setRightSize(null);
    }, [left.url, right.url]);

    useEffect(() => {
        if (!compare) return;
        const element = stageRef.current;
        if (!element) return;
        const update = () => {
            const rect = element.getBoundingClientRect();
            setStageSize({ width: rect.width, height: rect.height });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [compare]);

    const updateFromPointer = useCallback((clientX: number, clientY: number) => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        if (axis === 'x') {
            setRatio(clamp01((clientX - rect.left) / Math.max(1, rect.width)));
        } else {
            setRatio(clamp01((clientY - rect.top) / Math.max(1, rect.height)));
        }
    }, [axis]);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!compare) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (fade) {
            // Start a relative fade drag; do not jump to the click position.
            fadeDragRef.current = { startX: event.clientX, startRatio: ratio };
            return;
        }
        draggingRef.current = true;
        updateFromPointer(event.clientX, event.clientY);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!compare) return;
        if (fade) {
            const drag = fadeDragRef.current;
            if (!drag) return;
            setRatio(clamp01(drag.startRatio + (event.clientX - drag.startX) / FADE_DRAG_RANGE));
            return;
        }
        if (!draggingRef.current) return;
        updateFromPointer(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
        draggingRef.current = false;
        fadeDragRef.current = null;
    };

    const swapAssets = () => {
        setAssetA(assetB);
        setAssetB(assetA);
        setLeftSize(null);
        setRightSize(null);
    };

    const aBox = useMemo<Box>(() => {
        if (!leftSize || !stageSize.width || !stageSize.height) {
            return { left: 0, top: 0, width: 0, height: 0 };
        }
        const size = contain(leftSize, stageSize.width, stageSize.height);
        return {
            left: (stageSize.width - size.width) / 2,
            top: (stageSize.height - size.height) / 2,
            width: size.width,
            height: size.height,
        };
    }, [leftSize, stageSize]);

    const bSize = useMemo<Size>(() => {
        if (!rightSize || !aBox.width || !aBox.height) return { width: 0, height: 0 };
        switch (fitMode) {
            case 'fill':
                return cover(rightSize, aBox.width, aBox.height);
            case 'stretch':
                return { width: aBox.width, height: aBox.height };
            case 'original':
                return { width: rightSize.width, height: rightSize.height };
            case 'match-width': {
                const scale = aBox.width / rightSize.width;
                return { width: aBox.width, height: rightSize.height * scale };
            }
            case 'match-height': {
                const scale = aBox.height / rightSize.height;
                return { width: rightSize.width * scale, height: aBox.height };
            }
            case 'fit':
            default:
                return contain(rightSize, aBox.width, aBox.height);
        }
    }, [aBox, fitMode, rightSize]);

    const bBox = useMemo<Box>(() => ({
        left: aBox.left + (aBox.width - bSize.width) * anchor.x,
        top: aBox.top + (aBox.height - bSize.height) * anchor.y,
        width: bSize.width,
        height: bSize.height,
    }), [aBox, anchor, bSize]);

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
                    <span title={assetA.name}>A: {assetA.name}</span>
                    <span className="gallery-compare-vs">vs</span>
                    <span title={assetB.name}>B: {assetB.name}</span>
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
                    <Tooltip title="How B is scaled relative to A">
                        <Select
                            size="small"
                            value={fitMode}
                            disabled={!compare}
                            onChange={(value) => setFitMode(value)}
                            options={FIT_OPTIONS}
                            style={{ width: 176 }}
                            aria-label="Asset fit mode"
                        />
                    </Tooltip>
                    <Tooltip title="Anchor B relative to A">
                        <span className="gallery-compare-anchor">
                            {ANCHORS.map((item) => (
                                <button
                                    key={item.label}
                                    type="button"
                                    className={`gallery-compare-anchor-dot${anchor.x === item.x && anchor.y === item.y ? ' is-active' : ''}`}
                                    aria-label={item.label}
                                    disabled={!compare}
                                    onClick={() => setAnchor({ x: item.x, y: item.y })}
                                />
                            ))}
                        </span>
                    </Tooltip>
                    <Tooltip title="Swap the reference image A and the compared image B">
                        <Button
                            size="small"
                            icon={<SwapOutlined />}
                            onClick={swapAssets}
                            aria-label="Swap A and B"
                        >
                            Swap A/B
                        </Button>
                    </Tooltip>
                    <Tooltip title="Show A and B overlaid; turn off for side-by-side">
                        <label className="gallery-compare-switch">
                            <span>Overlay</span>
                            <Switch size="small" checked={compare} onChange={setCompare} />
                        </label>
                    </Tooltip>
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
                    <ComparisonMedia asset={assetB} style={bBox} onSize={setRightSize} positioned />
                    <div
                        className="gallery-compare-overlay"
                        style={fade ? { opacity: ratio } : { clipPath }}
                    >
                        <ComparisonMedia asset={assetA} style={aBox} onSize={setLeftSize} positioned />
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
                        <ComparisonMedia asset={assetA} />
                    </div>
                    <div className="gallery-compare-pane">
                        <ComparisonMedia asset={assetB} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default GalleryComparison;
