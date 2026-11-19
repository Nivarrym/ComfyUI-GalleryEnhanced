import { App, Button, Image, Popconfirm, Tooltip, Typography } from 'antd';
import type { FileDetails } from './types';
import CheckCircleFilled from '@ant-design/icons/lib/icons/CheckCircleFilled';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import ExportOutlined from '@ant-design/icons/lib/icons/ExportOutlined';
import FolderOpenOutlined from '@ant-design/icons/lib/icons/FolderOpenOutlined';
import InfoCircleOutlined from '@ant-design/icons/lib/icons/InfoCircleOutlined';
import PlayCircleFilled from '@ant-design/icons/lib/icons/PlayCircleFilled';
import SoundOutlined from '@ant-design/icons/lib/icons/SoundOutlined';
import React, { useEffect, useRef, useState } from 'react';
import { useDrag } from 'ahooks';
import { useGalleryContext } from './GalleryContext';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { use3DThumbnail } from './GlobalModelRenderer';
import { useThumbnail } from './thumbnails';

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ImageCard3DThumbnail = ({ image, onClick }: { image: FileDetails, onClick: () => void }) => {
    const { cardWidth } = useGalleryContext();
    const typeMatch = image.url.match(/\.([^.]+)$/);
    const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    const thumbnail = use3DThumbnail(`${BASE_PATH}${image.url}`, type);

    if (thumbnail) {
        return (
            <>
                <img
                    style={{
                        objectFit: "cover",
                        maxWidth: cardWidth,
                        width: '100%',
                        height: '100%',
                        userSelect: 'none',
                        cursor: 'pointer',
                    }}
                    src={thumbnail}
                    onClick={onClick}
                    alt={image.name}
                    draggable={false}
                />
                <Image
                    id={image.url}
                    style={{ display: 'none' }}
                    src={TRANSPARENT_PIXEL}
                    preview={{ src: `${BASE_PATH}${image.url}` }}
                />
            </>
        );
    }

    return (
        <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'var(--gallery-card-bg)', cursor: 'pointer' }}
            onClick={onClick}
        >
            <div style={{ fontSize: '64px', color: 'var(--gallery-accent)', marginBottom: '24px', fontWeight: 'bold' }}>3D</div>
            <Typography.Text style={{ padding: '0 16px', textAlign: 'center', maxWidth: '100%' }} ellipsis>
                {image.name}
            </Typography.Text>
            <Image
                id={image.url}
                style={{ display: 'none' }}
                src={TRANSPARENT_PIXEL}
                preview={{ src: `${BASE_PATH}${image.url}` }}
            />
        </div>
    );
};

function ImageCard({
    image,
    index,
    onInfoClick,
    onVideoClick
}: {
    image: FileDetails & { dragFolder?: string };
    index: number;
    onInfoClick: (imageName: string | undefined) => void;
    onVideoClick: (imageName: string | undefined) => void;
}) {
    const { settings, selectedSet, selectImage, deleteAssets, setPreviewingVideo, cardWidth, cardHeight } = useGalleryContext();
    const { message } = App.useApp();
    const dragRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [dragging, setDragging] = useState(false);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [videoMuted, setVideoMuted] = useState(true);
    const [videoHovered, setVideoHovered] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const { src: thumbnailSrc, state: thumbnailState } = useThumbnail(image, cardWidth, image.type === 'image');
    const originalSrc = `${BASE_PATH}${image.url}`;
    const selected = selectedSet.has(image.url);

    // Shift toggles the sound of the hovered looping video. Track Shift while
    // the pointer stays on the card so keydown/keyup both work.
    useEffect(() => {
        if (image.type !== 'media' || !videoHovered) return;
        const syncMuted = (event: KeyboardEvent) => {
            const video = videoRef.current;
            if (!video) return;
            const muted = !event.shiftKey;
            video.muted = muted;
            setVideoMuted(muted);
            if (!video.paused) {
                video.play().catch(() => { });
            }
        };
        window.addEventListener('keydown', syncMuted);
        window.addEventListener('keyup', syncMuted);
        return () => {
            window.removeEventListener('keydown', syncMuted);
            window.removeEventListener('keyup', syncMuted);
        };
    }, [image.type, videoHovered]);

    const handleCardMouseEnter = (event: React.MouseEvent) => {
        if (image.type !== 'media') return;
        setVideoHovered(true);
        const video = videoRef.current;
        if (!video) return;
        const muted = !event.shiftKey;
        video.muted = muted;
        video.loop = true;
        setVideoMuted(muted);
        if (settings.autoPlayVideos) {
            video.play().catch(() => {
                // Audible autoplay can be blocked until a user gesture; keep
                // the visual preview running muted and retry on the next event.
                video.muted = true;
                setVideoMuted(true);
                video.play().catch(() => { });
            });
        }
    };

    const handleCardMouseLeave = () => {
        if (image.type !== 'media') return;
        setVideoHovered(false);
        const video = videoRef.current;
        if (video) {
            video.pause();
            video.muted = true;
        }
        setVideoMuted(true);
        setVideoPlaying(false);
    };

    useDrag(
        {
            name: image.name,
            folder: image.dragFolder || '',
            type: image.type,
            url: image.url,
        },
        dragRef,
        {
            onDragStart: () => setDragging(true),
            onDragEnd: () => setDragging(false),
        }
    );

    // Modifier clicks must not open the antd preview; handle them in capture phase.
    const handleClickCapture = (event: React.MouseEvent) => {
        if ((event.target as HTMLElement).closest('.gallery-card-actions')) return;
        if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
        event.preventDefault();
        event.stopPropagation();
        selectImage(image.url, {
            ctrl: event.ctrlKey || event.metaKey,
            shift: event.shiftKey,
        });
    };

    const handleCardClick = () => {
        selectImage(image.url, {});
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const result = await deleteAssets([image.url]);
            if (result.deleted.length > 0) {
                message.success('Asset deleted');
            } else {
                message.error(result.failed[0]?.error || 'Failed to delete asset');
            }
        } finally {
            setDeleting(false);
        }
    };

    const handleReveal = async () => {
        const result = await ComfyAppApi.revealAsset(image.url);
        if (result.ok) {
            message.success('Shown in file manager');
        } else {
            message.error(result.error || 'Failed to show the asset in the file manager');
        }
    };

    const handleOpenExternal = async () => {
        const result = await ComfyAppApi.openAsset(image.url);
        if (result.ok) {
            message.success('Opened in the default application');
        } else {
            message.error(result.error || 'Failed to open the asset');
        }
    };

    // Native drag for exporting image as file/image
    const handleNativeDragStart = (event: React.DragEvent<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>) => {
        // Guess MIME based on filename extension (frontend-only, no backend changes)
        const guessMimeFromName = (name?: string) => {
            const ext = (name || '').split('.').pop()?.toLowerCase() || '';
            const map: Record<string, string> = {
                // images
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
                // video
                mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
                // audio
                mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg',
            };
            return map[ext] || '';
        };

        const guessed = guessMimeFromName(image.name || image.url);
        // Fallback to previous simple heuristic if we couldn't guess from extension
        const mimeType = guessed || (image.type === 'image' ? 'image/png' : image.type === 'audio' ? 'audio/wav' : 'video/mp4');

        event.dataTransfer.setData('text/uri-list', `${BASE_PATH}${image.url}`);
        event.dataTransfer.setData('DownloadURL', `${mimeType}:${image.name}:${window.location.origin + BASE_PATH + image.url}`);
    };

    const openPreview = () => {
        try { setPreviewingVideo(undefined); } catch { }
        document.getElementById(image.url)?.click();
    };

    const imageSrc = thumbnailSrc ?? (thumbnailState === 'error' ? originalSrc : TRANSPARENT_PIXEL);

    return (<>
        <div
            className={`image-card${selected ? ' gallery-card-selected' : ''}`}
            data-asset-url={image.url}
            data-asset-index={index}
            ref={dragRef}
            style={{
                width: cardWidth,
                height: cardHeight,
                borderRadius: 8,
                overflow: "hidden",
                margin: 8,
                opacity: dragging ? 0.5 : 1,
                display: "flex",
                alignContent: "center",
                justifyContent: "center",
                alignItems: "center",
                position: "relative",
                cursor: 'grab',
            }}
            onClickCapture={handleClickCapture}
            onClick={handleCardClick}
            onMouseEnter={handleCardMouseEnter}
            onMouseLeave={handleCardMouseLeave}
        >
            {image.type == "image" ? (<>
                {thumbnailState === 'loading' && <div className="gallery-thumb-placeholder" />}
                <Image
                    id={image.url}
                    style={{
                        objectFit: "cover",
                        position: "relative",
                        zIndex: 1,
                        ...(settings.imageThumbFit === 'height'
                            ? { maxHeight: cardHeight, width: 'auto', maxWidth: '100%' }
                            : { maxWidth: cardWidth, width: '100%', height: 'auto' }),
                        userSelect: 'none',
                        cursor: 'grab',
                    }}
                    src={imageSrc}
                    loading="lazy"
                    preview={{ src: originalSrc }}
                    onClick={() => setPreviewingVideo(undefined)}
                    alt={image.name}
                    draggable
                    onDragStart={handleNativeDragStart}
                    onError={() => { /* useThumbnail already falls back via state */ }}
                />
            </>) : image.type === "audio" ? (<>
                <div
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: 'pointer' }}
                    onClick={openPreview}
                >
                    <SoundOutlined style={{ fontSize: '64px', color: 'var(--gallery-accent)', marginBottom: '24px' }} />
                    <Typography.Text style={{ marginBottom: '16px', padding: '0 16px', textAlign: 'center', maxWidth: '100%' }} ellipsis>
                        {image.name}
                    </Typography.Text>
                    <audio controls preload="none" style={{ width: '90%', height: '40px' }} src={originalSrc} onClick={(e) => e.stopPropagation()} />
                    <Image
                        id={image.url}
                        style={{ display: 'none' }}
                        src={TRANSPARENT_PIXEL}
                        preview={{ src: originalSrc }}
                    />
                </div>
            </>) : image.type === "3d" ? (
                <ImageCard3DThumbnail image={image as any} onClick={openPreview} />
            ) : <>
                <video
                    ref={videoRef}
                    style={{
                        ...(settings.videoThumbFit === 'height'
                            ? { maxHeight: cardHeight }
                            : { maxWidth: cardWidth }),
                        cursor: "pointer",
                        zIndex: 1,
                    }}
                    src={originalSrc}
                    loop
                    muted={videoMuted}
                    playsInline
                    preload="metadata"
                    onPlaying={() => setVideoPlaying(true)}
                    onPause={() => setVideoPlaying(false)}
                    onClick={() => {
                        onVideoClick(image.name);
                        document.getElementById(image.url)?.click();
                    }}
                    draggable
                    onDragStart={handleNativeDragStart}
                />
                {!videoPlaying && settings.autoPlayVideos && <PlayCircleFilled className="gallery-card-play" />}
                <Image
                    id={image.url}
                    style={{ display: "none" }}
                    src={TRANSPARENT_PIXEL}
                    preview={{ src: originalSrc }}
                    alt={image.name}
                />
            </>}

            {selected && <CheckCircleFilled className="gallery-card-selected-check" />}

            <div
                className="gallery-card-actions"
                onClick={(event) => { event.stopPropagation(); event.preventDefault(); }}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <Tooltip title="Show in file manager">
                    <Button
                        className="gallery-card-action"
                        shape="circle"
                        size="small"
                        icon={<FolderOpenOutlined />}
                        onClick={handleReveal}
                        aria-label={`Show ${image.name} in file manager`}
                    />
                </Tooltip>
                <Tooltip title="Open in default application">
                    <Button
                        className="gallery-card-action"
                        shape="circle"
                        size="small"
                        icon={<ExportOutlined />}
                        onClick={handleOpenExternal}
                        aria-label={`Open ${image.name} in default application`}
                    />
                </Tooltip>
                <Popconfirm
                    title="Delete asset?"
                    description={image.name}
                    okText="Delete"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                    onConfirm={handleDelete}
                >
                    <Button
                        danger
                        type="primary"
                        shape="circle"
                        size="small"
                        loading={deleting}
                        icon={<DeleteOutlined />}
                        aria-label={`Delete ${image.name}`}
                    />
                </Popconfirm>
            </div>

            <div className="gallery-card-footer">
                <Typography.Text
                    strong
                    className="gallery-card-title"
                    ellipsis
                >
                    {image.name}
                </Typography.Text>
                <Tooltip title="Metadata">
                    <Button
                        color="cyan"
                        variant="filled"
                        icon={<InfoCircleOutlined />}
                        size={"middle"}
                        onClick={(event) => {
                            event.stopPropagation();
                            onInfoClick(image.name);
                            document.getElementById(image.url)?.click();
                        }}
                    />
                </Tooltip>
            </div>
        </div>
    </>)
}

export default ImageCard
