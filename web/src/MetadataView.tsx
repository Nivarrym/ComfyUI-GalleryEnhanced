import { Typography, Button, Flex, Descriptions, Tooltip, message, Image, Popconfirm, Spin, theme } from 'antd';
import { parseComfyMetadata } from './metadata-parser/metadataParser';
import { useState, useMemo, useCallback, useEffect } from 'react';
import type { FileDetails, Metadata } from './types';
import { hasMetadata } from './types';
import ReactJsonView from '@microlink/react-json-view';
import Modal from 'antd/es/modal/Modal';
import { ComfyAppApi, BASE_Z_INDEX } from './ComfyAppApi';
import { assetUrl } from './assetUrls';
import { useGalleryContext } from './GalleryContext';
import Card from 'antd/es/card/Card';
import CopyOutlined from '@ant-design/icons/lib/icons/CopyOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import SoundOutlined from '@ant-design/icons/lib/icons/SoundOutlined';
import { saveAs } from 'file-saver';
import { ModelViewer } from './ModelViewer';
import { galleryThemeClass } from './theme';

const PROMPT_ROW_LIMIT = 6;

export function MetadataView({
    image,
    onShowRaw,
    showRawMetadata,
    setShowRawMetadata,
    onRequestClose,
}: {
    image: FileDetails,
    onShowRaw: () => void,
    showRawMetadata: boolean,
    setShowRawMetadata: (show: boolean) => void,
    onRequestClose?: () => void,
}) {
    const [metadata, setMetadata] = useState<Metadata>(image.metadata);
    const [metaLoading, setMetaLoading] = useState(!hasMetadata(image));
    const [metaError, setMetaError] = useState(false);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

    const { mutate, currentFolder, deleteAssets, effectiveDarkMode } = useGalleryContext();
    const { token } = theme.useToken();

    // Metadata is loaded lazily by the server. Fetch it only when the info view
    // is actually opened, then cache it into the shared tree.
    useEffect(() => {
        let alive = true;
        setMetadata(image.metadata);
        setMetaError(false);
        if (hasMetadata(image)) {
            setMetaLoading(false);
            return () => { alive = false; };
        }
        setMetaLoading(true);
        ComfyAppApi.fetchMetadata(image.url)
            .then((fetched: Metadata) => {
                if (!alive) return;
                setMetadata(fetched);
                setMetaLoading(false);
                if (!hasMetadata({ metadata: fetched })) return;
                mutate((oldData) => {
                    if (!oldData?.folders?.[currentFolder]?.[image.name]) return oldData;
                    const folder = oldData.folders[currentFolder];
                    const folders = {
                        ...oldData.folders,
                        [currentFolder]: {
                            ...folder,
                            [image.name]: { ...folder[image.name], metadata: fetched },
                        },
                    };
                    return { ...oldData, folders };
                });
            })
            .catch(() => {
                if (!alive) return;
                setMetaError(true);
                setMetaLoading(false);
            });
        return () => { alive = false; };
    }, [image.url, image.name, image.timestamp, image.metadata, currentFolder, mutate]);

    const meta = useMemo(() => parseComfyMetadata(metadata), [metadata]);

    // Memoize prompt value renderer
    const renderPromptValue = useCallback((key: string, value: string) => {
        const isExpanded = expandedKeys[key];
        return (
            <Typography.Paragraph
                ellipsis={value.length > 300 ? {
                    rows: PROMPT_ROW_LIMIT,
                    expandable: 'collapsible',
                    expanded: isExpanded,
                    onExpand: () => setExpandedKeys(k => ({ ...k, [key]: !isExpanded })),
                } : false}
                style={{
                    marginBottom: 0,
                    whiteSpace: 'pre-line',
                    wordBreak: 'break-word'
                }}
            >
                {value}
            </Typography.Paragraph>
        );
    }, [expandedKeys]);

    // Memoize items for Descriptions
    const items = useMemo(() => Object.entries(meta).map(([key, value]) => {
        const isPrompt = key.toLowerCase().includes('prompt');
        return {
            label: (
                <Typography
                    style={{ fontWeight: 600 }}
                >
                    {key}
                </Typography>
            ),
            children: (
                <Tooltip
                    title={copiedKey === key ? 'Copied!' : 'Click to copy'}
                    placement="top"
                    color={copiedKey === key ? 'blue' : undefined}
                >
                    <Typography
                        style={{
                            cursor: 'pointer',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-line',
                            display: 'block',
                            maxWidth: 420
                        }}
                        onClick={() => {
                            navigator.clipboard.writeText(value);
                            setCopiedKey(key);
                            message.success('Copied!', 1);
                            setTimeout(() => setCopiedKey(null), 1200);
                        }}
                    >
                        {isPrompt ? renderPromptValue(key, value) : value}
                    </Typography>
                </Tooltip>
            ),
            span: 1,
        };
    }), [meta, copiedKey, renderPromptValue]);

    // Memoize image copy handler
    const handleCopyImage = useCallback(async () => {
        try {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.src = assetUrl(image);
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(async (blob) => {
                        if (blob) {
                            try {
                                await navigator.clipboard.write([
                                    new window.ClipboardItem({ [blob.type]: blob })
                                ]);
                                message.success('Image copied to clipboard');
                            } catch (err) {
                                message.error('Clipboard copy failed');
                            }
                        } else {
                            message.error('Failed to copy image');
                        }
                    }, 'image/png');
                } else {
                    message.error('Failed to copy image');
                }
            };
            img.onerror = () => {
                message.error('Failed to load image for copy (CORS)');
            };
        } catch (err) {
            message.error('Failed to copy image');
        }
    }, [image.url]);

    // Memoize download handler using FileSaver.js
    const handleDownload = useCallback(async () => {
        try {
            const response = await fetch(assetUrl(image), { mode: 'cors' });
            if (!response.ok) throw new Error('Network response was not ok');
            const blob = await response.blob();
            saveAs(blob, image.name);
        } catch (err) {
            message.error('Failed to download file (CORS)');
        }
    }, [image.url, image.name]);

    // Memoize delete handler
    const handleDelete = useCallback(async () => {
        const result = await deleteAssets([image.url]);
        if (result.deleted.length > 0) {
            message.success('Image deleted');
        } else {
            message.error(result.failed[0]?.error || 'Failed to delete image');
        }
    }, [deleteAssets, image.url]);

    return (
        <div
            key={image.name}
            onClick={(event) => {
                // The metadata view fills the preview surface. A click on the
                // empty backdrop (not on the image/info cards) closes it.
                if (event.target === event.currentTarget) {
                    onRequestClose?.();
                }
            }}
            style={{
                width: "100%",
                height: "-webkit-fill-available",
                display: "flex",
                flexWrap: "wrap",
                alignContent: "center",
                justifyContent: "space-evenly",
                alignItems: "center",
                overflow: "auto",
                padding: "30px",
                placeContent: "space-evenly"
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    flexWrap: "wrap",
                    alignContent: "center",
                    justifyContent: "center",
                    alignItems: "center",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-start",
                        alignItems: "center",
                        marginBottom: "8px",
                        width: "100%",
                        alignContent: "center",
                        flexWrap: "wrap",
                        flexDirection: "row",
                        gap: "30px",
                        placeContent: "space-between"
                    }}
                >
                    <Tooltip
                        title="Show the raw JSON metadata"
                        placement="left"
                    >
                        <Button
                            type='dashed'
                            onClick={onShowRaw}
                        >
                            Show Raw Metadata
                        </Button>
                    </Tooltip>
                    <Popconfirm
                        title="Delete the image"
                        description="Are you sure you want to delete this image?"
                        onConfirm={handleDelete}
                        onCancel={() => message.info('Delete cancelled')}
                        okText="Yes"
                        cancelText="No"
                    >
                        <Button
                            danger
                            type='primary'
                        >
                            Delete
                        </Button>
                    </Popconfirm>
                </div>
                <div
                    style={{
                        position: 'relative',
                        width: 'fit-content',
                        margin: '0 auto'
                    }}
                >
                    {/* Overlay buttons */}
                    <div
                        style={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            zIndex: 2
                        }}
                    >
                        {image.type === 'image' && (
                            <Tooltip title={copiedKey === 'image' ? 'Copied!' : 'Copy image to clipboard'}>
                                <Button
                                    shape="circle"
                                    icon={<CopyOutlined />}
                                    size="small"
                                    style={{
                                        background: token.colorBgElevated,
                                        color: token.colorText,
                                        border: 'none',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
                                    }}
                                    onClick={async () => {
                                        try {
                                            const img = new window.Image();
                                            img.crossOrigin = 'anonymous';
                                            img.src = assetUrl(image);
                                            img.onload = async () => {
                                                const canvas = document.createElement('canvas');
                                                canvas.width = img.width;
                                                canvas.height = img.height;
                                                const ctx = canvas.getContext('2d');
                                                if (ctx) {
                                                    ctx.drawImage(img, 0, 0);
                                                    canvas.toBlob(async (blob) => {
                                                        if (blob) {
                                                            try {
                                                                await navigator.clipboard.write([
                                                                    new window.ClipboardItem({ [blob.type]: blob })
                                                                ]);
                                                                setCopiedKey('image');
                                                                message.success('Image copied to clipboard');
                                                                setTimeout(() => setCopiedKey(null), 1200);
                                                            } catch (err) {
                                                                message.error('Clipboard copy failed');
                                                            }
                                                        } else {
                                                            message.error('Failed to copy image');
                                                        }
                                                    }, 'image/png');
                                                } else {
                                                    message.error('Failed to copy image');
                                                }
                                            };
                                            img.onerror = () => {
                                                message.error('Failed to load image for copy (CORS)');
                                            };
                                        } catch (err) {
                                            message.error('Failed to copy image');
                                        }
                                    }}
                                />
                            </Tooltip>
                        )}
                        {image.type === 'image' && (<Tooltip title="Download">
                            <Button
                                shape="circle"
                                icon={<DownloadOutlined />}
                                size="small"
                                style={{
                                    background: token.colorBgElevated,
                                    color: token.colorText,
                                    border: 'none',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
                                }}
                                onClick={handleDownload}
                            />
                        </Tooltip>)}
                    </div>
                    {image.type == "image" && (
                        <Image
                            preview={false}
                            style={{
                                objectFit: 'cover',
                                maxWidth: 420,
                                maxHeight: 600,
                                borderRadius: 12,
                                background: token.colorBgElevated,
                            }}
                            src={assetUrl(image)}
                            loading="lazy"
                        />
                    )}
                    {image.type == "media" && (
                        <video
                            style={{
                                objectFit: 'cover',
                                maxWidth: 420,
                                maxHeight: 600,
                                borderRadius: 12,
                                background: token.colorBgElevated,
                            }}
                            src={assetUrl(image)}
                            autoPlay={true}
                            controls={true}
                            preload="none"
                        />
                    )}
                    {image.type == "audio" && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '420px', height: '400px', background: token.colorBgContainer, borderRadius: 12 }}>
                            <SoundOutlined style={{ fontSize: '100px', color: token.colorPrimary, marginBottom: '40px' }} />
                            <audio
                                style={{ width: '80%' }}
                                src={assetUrl(image)}
                                autoPlay={true}
                                controls={true}
                                preload="none"
                            />
                        </div>
                    )}
                    {image.type == "3d" && (
                        <div 
                            style={{ width: '80vw', maxWidth: 1000, height: '70vh', cursor: 'grab' }}
                            onMouseDown={e => e.stopPropagation()}
                            onTouchStart={e => e.stopPropagation()}
                        >
                            <ModelViewer url={assetUrl(image)} type={image.name.split('.').pop()?.toLowerCase() || ''} />
                        </div>
                    )}
                </div>
            </div>
            {image.type === 'image' && (
                <Card
                    style={{
                        background: token.colorBgElevated,
                        borderColor: token.colorBorderSecondary,
                        boxShadow: token.boxShadowSecondary,
                        maxHeight: '82vh',
                        overflowY: 'auto',
                    }}
                >
                    {metaLoading ? (
                        <Flex align="center" justify="center" style={{ minWidth: 260, minHeight: 120 }}>
                            <Spin tip="Loading metadata..." />
                        </Flex>
                    ) : metaError && items.length === 0 ? (
                        <Typography.Text type="secondary">Metadata is unavailable for this asset.</Typography.Text>
                    ) : items.length === 0 ? (
                        <Typography.Text type="secondary">No metadata in this file.</Typography.Text>
                    ) : (
                        <Descriptions
                            bordered
                            column={1}
                            items={items}
                            style={{
                                borderRadius: 8,
                                padding: 8,
                                width: '100%',
                                maxWidth: 520
                            }}
                            styles={{
                                label: {
                                    fontWeight: 600,
                                    width: 120,
                                },
                                content: {
                                    fontWeight: 400,
                                }
                            }}
                        />
                    )}
                </Card>
            )}
            <Modal
                zIndex={BASE_Z_INDEX + 2}
                rootClassName={`gallery-modal-root ${galleryThemeClass(effectiveDarkMode)}`}
                title={image ? `Raw Metadata: ${image.name}` : 'Raw Metadata'}
                open={showRawMetadata}
                onCancel={() => setShowRawMetadata(false)}
                footer={null}
                width={"100%"}
                height={"100%"}
                style={{
                    padding: "40px"
                }}
                centered
            >
                {image && showRawMetadata && (
                    <div
                        onMouseDown={e => e.stopPropagation()}
                        onTouchStart={e => e.stopPropagation()}
                    >
                        <ReactJsonView
                            theme={effectiveDarkMode ? "apathy" : "rjv-default"}
                            src={metadata || {}}
                            name={false}
                            collapsed={2}
                            enableClipboard={true}
                            displayDataTypes={false}
                            style={{
                                background: 'transparent',
                            }}
                        />
                    </div>
                )}
            </Modal>
        </div>
    );
}
