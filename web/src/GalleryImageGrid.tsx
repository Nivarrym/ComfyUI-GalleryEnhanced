import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { Empty, Image, Spin } from 'antd';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { MetadataView } from './MetadataView';
import { ModelViewer } from './ModelViewer';
import type { FileDetails } from './types';
import { BASE_PATH } from "./ComfyAppApi";
import { useBoxSelection } from './useBoxSelection';
import SelectionToolbar from './SelectionToolbar';
import { perfMeasure } from './perf';

const GalleryImageGrid = () => {
    const {
        data,
        dataRevision,
        currentFolder,
        settings,
        loading,
        imageInfoName,
        setImageInfoName,
        previewingVideo,
        setPreviewingVideo,
        showRawMetadata,
        setShowRawMetadata,
        autoSizer,
        setAutoSizer,
        gridSize,
        setGridSize,
        imagesDetailsList,
        imagesUrlsLists,
        selectedImages,
        setSelectedImages,
        clearSelection,
    } = useGalleryContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<any>(null);

    const handleInfoClick = useCallback((imageName: string) => {
        const item = data?.folders?.[currentFolder]?.[imageName];
        if (item && (item.type === 'media' || item.type === 'audio' || item.type === '3d')) {
            setPreviewingVideo(item.name);
        } else {
            setPreviewingVideo(undefined);
        }
        setImageInfoName(imageName);
    }, [setImageInfoName, data, currentFolder, setPreviewingVideo]);

    const { marquee, onPointerDown } = useBoxSelection({
        containerRef,
        selected: selectedImages,
        onChange: setSelectedImages,
        onClear: clearSelection,
        enabled: !previewingVideo,
    });

    const Cell = useCallback(({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
        const index = rowIndex * gridSize.columnCount + columnIndex;
        const image = imagesDetailsList[index];
        if (!image) return null;
        if (image.type === 'divider') {
            if (columnIndex !== 0) return null;
            return (
                <div
                    key={`divider-${index}`}
                    style={{
                        ...style,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: `calc(${gridSize.columnCount} * ${ImageCardWidth + 16}px)`,
                        gridColumn: `span ${gridSize.columnCount}`,
                        background: 'transparent',
                        padding: 0,
                        minHeight: 48,
                        position: 'absolute',
                        zIndex: 2,
                        pointerEvents: 'none',
                    }}
                >
                    <div className="gallery-date-divider-label">
                        <span className="gallery-date-divider-text">{image.name}</span>
                    </div>
                </div>
            );
        }
        if (image.type === 'empty-space') {
            return (
                <div
                    key={`empty-space-${index}`}
                    style={{
                        ...style,
                        background: 'transparent'
                    }}
                />
            );
        }
        return (
            <div
                key={`div-${image.name}`}
                style={{
                    ...style,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center'
                }}
            >
                <ImageCard
                    image={{
                        ...image,
                        dragFolder: currentFolder
                    }}
                    key={image.name}
                    index={index}
                    onInfoClick={() => handleInfoClick(image.name)}
                    onVideoClick={() => setPreviewingVideo(image.name)}
                />
            </div>
        );
    }, [gridSize.columnCount, imagesDetailsList, handleInfoClick, setPreviewingVideo, currentFolder]);

    const rowHeight = useCallback((index: number) => {
        const firstCell = imagesDetailsList[index * gridSize.columnCount];
        return firstCell?.type === 'divider' ? 56 : ImageCardHeight + 16;
    }, [gridSize.columnCount, imagesDetailsList]);

    useEffect(() => {
        gridRef.current?.resetAfterIndices?.({ rowIndex: 0, columnIndex: 0, shouldForceUpdate: true });
    }, [imagesDetailsList, gridSize.columnCount]);

    useEffect(() => {
        const { width, height } = autoSizer;
        const columnCount = Math.max(1, Math.floor(width / (ImageCardWidth + 16)));
        const rowCount = Math.ceil(imagesDetailsList.length / columnCount);
        if (gridSize.width !== width || gridSize.height !== height || gridSize.columnCount !== columnCount || gridSize.rowCount !== rowCount) {
            setGridSize({ width, height, columnCount, rowCount });
        }
    }, [autoSizer.width, autoSizer.height, imagesDetailsList.length]);

    useEffect(() => {
        gridRef.current?.scrollToItem({ rowIndex: 0, columnIndex: 0, align: 'start' });
    }, [currentFolder]);

    useEffect(() => {
        if (loading || dataRevision === 0) return;
        const frame = window.requestAnimationFrame(() => {
            perfMeasure('grid.firstPaint', 'data.ready', { items: imagesDetailsList.length, folder: currentFolder });
        });
        return () => window.cancelAnimationFrame(frame);
        // Only measure a paint triggered by a fresh /Gallery/images response.
    }, [loading, dataRevision]);

    // Memoized previewable images for InfoView navigation and rendering
    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === "image" || img.type === "media" || img.type === "audio" || img.type === "3d"),
        [imagesDetailsList]
    );

    const stopPropagation = useCallback((e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
    }, []);

    const customImageRender = useCallback((originalNode: React.ReactElement, info: { current: number }) => {
        const image = previewableImages[info.current];
        if (!image) return originalNode;
        if (imageInfoName != undefined) {
            return (
                <MetadataView
                    image={image}
                    onShowRaw={() => setShowRawMetadata(true)}
                    showRawMetadata={showRawMetadata}
                    setShowRawMetadata={setShowRawMetadata}
                />
            );
        }
        if (image.type === 'audio') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                    <h2 style={{ color: 'white', marginBottom: '24px', maxWidth: '80%', textAlign: 'center', wordWrap: 'break-word' }}>
                        {image.name}
                    </h2>
                    <audio
                        key={image.name}
                        style={{ maxWidth: "-webkit-fill-available", width: "80%" }}
                        src={`${BASE_PATH}${image.url}`}
                        autoPlay={true}
                        controls={true}
                        preload="none"
                        ref={el => {
                            if (el && !settings.autoPlayVideos) {
                                el.pause(); el.currentTime = 0;
                            }
                        }}
                    />
                </div>
            );
        }
        if (image.type === '3d') {
            return (
                <div
                    style={{ width: '80vw', maxWidth: 1000, height: '70vh', cursor: 'grab' }}
                    onMouseDown={stopPropagation}
                    onTouchStart={stopPropagation}
                >
                    <ModelViewer url={`${BASE_PATH}${image.url}`} type={image.name.split('.').pop()?.toLowerCase() || ''} />
                </div>
            );
        }
        if (image.type === 'media') {
            return (
                <video
                    key={image.name}
                    style={{
                        maxWidth: "fit-content", width: "80%",
                        maxHeight: "fit-content", height: "80%"
                    }}
                    src={`${BASE_PATH}${image.url}`}
                    autoPlay={true}
                    controls={true}
                    preload="none"
                    ref={el => {
                        if (el && !settings.autoPlayVideos) {
                            el.pause(); el.currentTime = 0;
                        }
                    }}
                />
            );
        }
        return originalNode;
    }, [imageInfoName, previewableImages, showRawMetadata, setShowRawMetadata, settings.autoPlayVideos, stopPropagation]);

    const infoOnChange = useCallback((current: number) => {
        setImageInfoName(previewableImages[current]?.name);
    }, [setImageInfoName, previewableImages]);

    const infoAfterOpenChange = useCallback((open: boolean) => {
        if (!open) setImageInfoName(undefined);
    }, [setImageInfoName]);

    const videoOnChange = useCallback((current: number) => {
        const t = previewableImages[current]?.type;
        if (t == "media" || t == "audio" || t == "3d") {
            setPreviewingVideo(previewableImages[current]?.name);
        } else {
            setPreviewingVideo(undefined);
        }
    }, [setPreviewingVideo, previewableImages]);

    return (
        <div id="imagesBox" className="gallery-grid-root" style={{ width: '100%', height: '100%', position: 'relative' }} ref={containerRef} onPointerDown={onPointerDown}>
            {loading && (
                <div className="gallery-loading-mask">
                    <Spin size="large" tip="Loading..." />
                </div>
            )}
            <Image.PreviewGroup
                items={imagesUrlsLists}
                preview={(imageInfoName != undefined) ? {
                    imageRender: customImageRender,
                    toolbarRender: () => null,
                    onChange: infoOnChange,
                    afterOpenChange: infoAfterOpenChange,
                    destroyOnClose: true
                } : {
                    onChange: videoOnChange,
                    imageRender: customImageRender,
                    toolbarRender: () => previewingVideo != undefined ? null : undefined,
                    destroyOnClose: true,
                    afterOpenChange(open) {
                        if (!open) setPreviewingVideo(undefined);
                    },
                }}
            >
                {imagesDetailsList.length === 0 ? (
                    <Empty
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)"
                        }}
                        description={"No images found"}
                    />
                ) : (
                    <AutoSizer>
                        {({ width, height }) => {
                            if (autoSizer.width !== width || autoSizer.height !== height) {
                                setTimeout(() => setAutoSizer({ width, height }), 0);
                            }
                            return (
                                <VariableSizeGrid
                                    ref={gridRef}
                                    columnCount={gridSize.columnCount}
                                    rowCount={gridSize.rowCount}
                                    columnWidth={() => ImageCardWidth + 16}
                                    rowHeight={rowHeight}
                                    estimatedRowHeight={ImageCardHeight + 16}
                                    estimatedColumnWidth={ImageCardWidth + 16}
                                    width={width}
                                    height={height}
                                    className={"grid-element"}
                                    style={{
                                        display: "flex",
                                        alignContent: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    {Cell}
                                </VariableSizeGrid>
                            );
                        }}
                    </AutoSizer>
                )}
            </Image.PreviewGroup>

            {marquee && (
                <div
                    className="gallery-marquee"
                    style={{
                        left: marquee.left,
                        top: marquee.top,
                        width: marquee.width,
                        height: marquee.height,
                    }}
                />
            )}

            <SelectionToolbar />
        </div>
    );
};

export default GalleryImageGrid;
