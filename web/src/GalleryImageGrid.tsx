import React, { useMemo, useCallback, useRef } from 'react';
import { Image, Spin } from 'antd';
import { useGalleryContext } from './GalleryContext';
import { MetadataView } from './MetadataView';
import { ModelViewer } from './ModelViewer';
import { assetUrl } from './assetUrls';
import { useBoxSelection } from './useBoxSelection';
import SelectionToolbar from './SelectionToolbar';
import GalleryGridBody from './GalleryGridBody';

const GalleryImageGrid = () => {
    const {
        data,
        currentFolder,
        settings,
        loading,
        imageInfoName,
        setImageInfoName,
        previewingVideo,
        setPreviewingVideo,
        showRawMetadata,
        setShowRawMetadata,
        imagesDetailsList,
        imagesUrlsLists,
        selectedImages,
        setSelectedImages,
        clearSelection,
    } = useGalleryContext();
    const containerRef = useRef<HTMLDivElement>(null);

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
                        src={assetUrl(image)}
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
                    <ModelViewer url={assetUrl(image)} type={image.name.split('.').pop()?.toLowerCase() || ''} />
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
                    src={assetUrl(image)}
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
        <div
            id="imagesBox"
            className="gallery-grid-root"
            style={{ width: '100%', height: '100%', position: 'relative' }}
            ref={containerRef}
            onPointerDown={onPointerDown}
        >
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
                <GalleryGridBody
                    imagesDetailsList={imagesDetailsList}
                    currentFolder={currentFolder}
                    onInfoClick={handleInfoClick}
                    onVideoClick={setPreviewingVideo}
                />
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
