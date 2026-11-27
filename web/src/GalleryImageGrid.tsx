import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react';
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
        previewMode,
        setPreviewMode,
        getPreviewMode,
        selectImage,
        showRawMetadata,
        setShowRawMetadata,
        imagesDetailsList,
        imagesUrlsLists,
        selectedImages,
        setSelectedImages,
        clearSelection,
        previewAssetUrl,
        setPreviewAssetUrl,
        isAssetTrashed,
    } = useGalleryContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewCurrent, setPreviewCurrent] = useState<number | undefined>(undefined);

    const handleInfoClick = useCallback((imageName: string) => {
        setPreviewMode('plain');
        const item = data?.folders?.[currentFolder]?.[imageName];
        if (item && (item.type === 'media' || item.type === 'audio' || item.type === '3d')) {
            setPreviewingVideo(item.name);
        } else {
            setPreviewingVideo(undefined);
        }
        setImageInfoName(imageName);
    }, [setImageInfoName, data, currentFolder, setPreviewMode, setPreviewingVideo]);

    const handleVideoClick = useCallback((imageName: string | undefined) => {
        setPreviewMode('plain');
        setPreviewingVideo(imageName);
    }, [setPreviewMode, setPreviewingVideo]);

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

    const closePreview = useCallback(() => {
        const root = document.querySelector('.ant-image-preview-root');
        const closeButton = root?.querySelector<HTMLElement>('.ant-image-preview-close');
        closeButton?.click();
        // rc-dialog can remain stuck in its leave transition with a custom
        // imageRender. Remove the stale portal as a fallback.
        window.setTimeout(() => {
            document.querySelector('.ant-image-preview-root')?.remove();
            setPreviewOpen(false);
            setImageInfoName(undefined);
            setPreviewingVideo(undefined);
            setPreviewMode(null);
        }, 0);
    }, [setImageInfoName, setPreviewMode, setPreviewingVideo]);

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
                    onRequestClose={closePreview}
                />
            );
        }
        if (image.type === 'image') {
            return (
                <div className="gallery-preview-image-shell">
                    <div className="gallery-preview-filename" title={image.name}>
                        {image.name}
                    </div>
                    {originalNode}
                </div>
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
    }, [imageInfoName, previewableImages, showRawMetadata, setShowRawMetadata, settings.autoPlayVideos, stopPropagation, closePreview]);

    const infoOnChange = useCallback((current: number) => {
        setImageInfoName(previewableImages[current]?.name);
    }, [setImageInfoName, previewableImages]);

    const infoAfterOpenChange = useCallback((open: boolean) => {
        setPreviewOpen(open);
        if (!open) {
            setImageInfoName(undefined);
            setPreviewMode(null);
        }
    }, [setImageInfoName, setPreviewMode]);

    const imageOnChange = useCallback((current: number) => {
        const image = previewableImages[current];
        setPreviewCurrent(current);
        if (!image) return;
        setPreviewAssetUrl(image.url);
        if (getPreviewMode() === 'selection') {
            // The image currently being viewed is the one Delete must target.
            selectImage(image.url, {});
        }
        if (image.type === 'media' || image.type === 'audio' || image.type === '3d') {
            setPreviewingVideo(image.name);
        } else {
            setPreviewingVideo(undefined);
        }
    }, [getPreviewMode, previewMode, previewableImages, selectImage, setPreviewAssetUrl, setPreviewingVideo]);

    const imageAfterOpenChange = useCallback((open: boolean) => {
        setPreviewOpen(open);
        if (!open) {
            setPreviewingVideo(undefined);
            setPreviewMode(null);
            setPreviewAssetUrl(undefined);
            setPreviewCurrent(undefined);
        }
    }, [setPreviewAssetUrl, setPreviewingVideo, setPreviewMode]);

    // Space marks the current preview image as trash; move to the next image,
    // optionally skipping images that already carry the trash mark.
    useEffect(() => {
        const advanceAfterTrash = () => {
            if (!previewOpen || previewableImages.length === 0) return;
            const currentIndex = previewCurrent ?? previewableImages.findIndex((item) => item.url === previewAssetUrl);
            if (currentIndex < 0) return;
            for (let step = 1; step <= previewableImages.length; step += 1) {
                const nextIndex = (currentIndex + step) % previewableImages.length;
                const candidate = previewableImages[nextIndex];
                if (!candidate || candidate.url === previewAssetUrl) continue;
                if (settings.skipTrashWhenAdvancing && isAssetTrashed(candidate.url)) continue;
                setPreviewCurrent(nextIndex);
                setPreviewAssetUrl(candidate.url);
                return;
            }
        };
        window.addEventListener('gallery:preview-advance', advanceAfterTrash);
        return () => window.removeEventListener('gallery:preview-advance', advanceAfterTrash);
    }, [previewOpen, previewCurrent, previewableImages, previewAssetUrl, settings.skipTrashWhenAdvancing, isAssetTrashed, setPreviewAssetUrl]);

    useEffect(() => {
        setPreviewCurrent((current) => {
            if (previewableImages.length === 0) return undefined;
            if (current === undefined) return current;
            return current >= previewableImages.length ? 0 : current;
        });
    }, [previewableImages.length]);

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
                    current: previewCurrent,
                    imageRender: customImageRender,
                    onChange: infoOnChange,
                    afterOpenChange: infoAfterOpenChange,
                    maskClosable: true,
                    destroyOnClose: true,
                    transitionName: '',
                    maskTransitionName: ''
                } : {
                    current: previewCurrent,
                    onChange: imageOnChange,
                    imageRender: customImageRender,
                    toolbarRender: () => previewingVideo != undefined ? null : undefined,
                    maskClosable: true,
                    destroyOnClose: true,
                    transitionName: '',
                    maskTransitionName: '',
                    afterOpenChange: imageAfterOpenChange,
                }}
            >
                <GalleryGridBody
                    imagesDetailsList={imagesDetailsList}
                    currentFolder={currentFolder}
                    onInfoClick={handleInfoClick}
                    onVideoClick={handleVideoClick}
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

            <SelectionToolbar overlay={previewOpen && previewMode === 'selection'} />
        </div>
    );
};

export default GalleryImageGrid;
