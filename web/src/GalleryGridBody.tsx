import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty } from 'antd';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard from './ImageCard';
import { useGalleryContext, useGalleryLayout } from './GalleryContext';
import type { FileDetails } from './types';
import { perfMeasure } from './perf';

interface GalleryGridBodyProps {
    imagesDetailsList: FileDetails[];
    currentFolder: string;
    onInfoClick: (imageName: string) => void;
    onVideoClick: (imageName: string | undefined) => void;
}

/**
 * Virtualized body. Kept separate from the preview/dialog wrapper so live card
 * resizing re-renders only the grid body, not the Ant Design PreviewGroup and
 * the rest of the gallery chrome.
 */
const GalleryGridBody = ({ imagesDetailsList, currentFolder, onInfoClick, onVideoClick }: GalleryGridBodyProps) => {
    const {
        dataRevision,
        loading,
        sortMethod,
        settings,
        selectedSet,
        selectImage,
        deleteAssets,
        setPreviewingVideo,
    } = useGalleryContext();
    const { cardWidth, cardHeight, thumbSizePreview } = useGalleryLayout();
    const gridRef = useRef<any>(null);
    const [gridSize, setGridSize] = useState({ width: 1000, height: 600, columnCount: 1, rowCount: 1 });
    const [autoSizer, setAutoSizer] = useState({ width: 1000, height: 600 });

    // Build divider/empty cells locally. Keeping this out of GalleryContext
    // means resizing never invalidates the header, sidebar or cards.
    const gridItems = useMemo(() => {
        if (!settings.showDateDivider || (sortMethod !== 'Newest' && sortMethod !== 'Oldest')) {
            return imagesDetailsList;
        }
        const colCount = Math.max(1, gridSize.columnCount || 1);
        const grouped: { [date: string]: FileDetails[] } = {};
        imagesDetailsList.forEach(item => {
            const date = item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
            if (!grouped[date]) grouped[date] = [];
            grouped[date].push(item);
        });
        const result: FileDetails[] = [];
        Object.entries(grouped).forEach(([date, items]) => {
            for (let i = 0; i < colCount; i++) {
                result.push({ name: date, type: 'divider' } as FileDetails);
            }
            result.push(...items);
            const remainder = items.length % colCount;
            if (remainder !== 0 && colCount > 1) {
                for (let i = 0; i < colCount - remainder; i++) {
                    result.push({ type: 'empty-space' } as FileDetails);
                }
            }
        });
        return result;
    }, [imagesDetailsList, settings.showDateDivider, sortMethod, gridSize.columnCount]);

    const Cell = useCallback(({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
        const index = rowIndex * gridSize.columnCount + columnIndex;
        const image = gridItems[index];
        if (!image) return null;
        if (image.type === 'divider') {
            if (columnIndex !== 0) return null;
            return (
                <div
                    style={{
                        ...style,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: `calc(${gridSize.columnCount} * ${cardWidth + 16}px)`,
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
                    style={{ ...style, background: 'transparent' }}
                />
            );
        }
        return (
            <div
                style={{
                    ...style,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <ImageCard
                    image={image}
                    dragFolder={currentFolder}
                    onInfoClick={onInfoClick}
                    onVideoClick={onVideoClick}
                    settings={settings}
                    selectedSet={selectedSet}
                    selectImage={selectImage}
                    deleteAssets={deleteAssets}
                    setPreviewingVideo={setPreviewingVideo}
                />
            </div>
        );
    }, [gridSize.columnCount, gridItems, onInfoClick, onVideoClick, currentFolder, cardWidth, settings, selectedSet, selectImage, deleteAssets, setPreviewingVideo]);

    const rowHeight = useCallback((index: number) => {
        const firstCell = gridItems[index * gridSize.columnCount];
        return firstCell?.type === 'divider' ? 56 : cardHeight + 16;
    }, [gridSize.columnCount, gridItems, cardHeight]);

    useEffect(() => {
        // During a live size drag, reset the cached row metadata without forcing
        // an extra synchronous render; the next animation frame corrects the
        // visible cells. On commit, force a final recompute.
        gridRef.current?.resetAfterIndices?.({
            rowIndex: 0,
            columnIndex: 0,
            shouldForceUpdate: thumbSizePreview === null,
        });
    }, [gridItems, gridSize.columnCount, cardWidth, cardHeight, thumbSizePreview]);

    useEffect(() => {
        const { width, height } = autoSizer;
        const columnCount = Math.max(1, Math.floor(width / (cardWidth + 16)));
        const rowCount = Math.ceil(gridItems.length / columnCount);
        if (gridSize.width !== width || gridSize.height !== height || gridSize.columnCount !== columnCount || gridSize.rowCount !== rowCount) {
            setGridSize({ width, height, columnCount, rowCount });
        }
    }, [autoSizer.width, autoSizer.height, gridItems.length, cardWidth]);

    useEffect(() => {
        gridRef.current?.scrollToItem({ rowIndex: 0, columnIndex: 0, align: 'start' });
    }, [currentFolder]);

    useEffect(() => {
        if (loading || dataRevision === 0) return;
        const frame = window.requestAnimationFrame(() => {
            perfMeasure('grid.firstPaint', 'data.ready', { items: gridItems.length, folder: currentFolder });
        });
        return () => window.cancelAnimationFrame(frame);
        // Only measure a paint triggered by a fresh /Gallery/images response.
    }, [loading, dataRevision]);

    return (
        <div
            className="gallery-grid-body"
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                ['--gallery-card-width' as string]: `${cardWidth}px`,
                ['--gallery-card-height' as string]: `${cardHeight}px`,
            } as React.CSSProperties}
        >
            {imagesDetailsList.length === 0 ? (
                <Empty
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                    }}
                    description={'No images found'}
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
                                columnWidth={() => cardWidth + 16}
                                rowHeight={rowHeight}
                                estimatedRowHeight={cardHeight + 16}
                                estimatedColumnWidth={cardWidth + 16}
                                width={width}
                                height={height}
                                className={'grid-element'}
                                style={{
                                    display: 'flex',
                                    alignContent: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                {Cell}
                            </VariableSizeGrid>
                        );
                    }}
                </AutoSizer>
            )}
        </div>
    );
};

export default GalleryGridBody;
