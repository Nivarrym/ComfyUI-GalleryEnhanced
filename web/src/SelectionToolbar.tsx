import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, Tooltip } from 'antd';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import CheckSquareOutlined from '@ant-design/icons/lib/icons/CheckSquareOutlined';
import CloseOutlined from '@ant-design/icons/lib/icons/CloseOutlined';
import PlusSquareOutlined from '@ant-design/icons/lib/icons/PlusSquareOutlined';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { addGalleryImagesToGraph, galleryImagesFromSelection } from './GalleryGraph';
import { galleryThemeClass } from './theme';

/**
 * Floating selection actions: batch download, batch delete, select all, clear.
 * The same delete flow is triggered by the Delete/Backspace keyboard shortcut.
 */
const SelectionToolbar = ({ overlay = false }: { overlay?: boolean }) => {
    const {
        selectedImages,
        selectableImages,
        selectAllVisible,
        clearSelection,
        deleteAssets,
        settings,
        effectiveDarkMode,
    } = useGalleryContext();
    const { modal, message } = App.useApp();
    const [downloading, setDownloading] = useState(false);

    const count = selectedImages.length;

    const confirmDelete = useCallback(() => {
        if (selectedImages.length === 0) return;
        const urls = [...selectedImages];
        modal.confirm({
            zIndex: overlay ? 2147483002 : BASE_Z_INDEX + 10,
            title: `Delete ${urls.length} asset${urls.length === 1 ? '' : 's'}?`,
            content: 'This permanently removes the selected files from disk. This cannot be undone.',
            okText: `Delete (${urls.length})`,
            okType: 'danger',
            cancelText: 'Cancel',
            centered: true,
            onOk: async () => {
                const result = await deleteAssets(urls);
                if (result.deleted.length > 0) {
                    message.success(`Deleted ${result.deleted.length} asset${result.deleted.length === 1 ? '' : 's'}`);
                }
                if (result.failed.length > 0) {
                    message.error(`Failed to delete ${result.failed.length} asset${result.failed.length === 1 ? '' : 's'}: ${result.failed[0]?.error ?? 'unknown error'}`);
                }
                if (result.deleted.length === 0 && result.failed.length === 0) {
                    message.error('Nothing was deleted');
                }
            },
        });
    }, [deleteAssets, message, modal, overlay, selectedImages]);

    useEffect(() => {
        const handler = () => confirmDelete();
        window.addEventListener('gallery:delete-selected', handler);
        return () => window.removeEventListener('gallery:delete-selected', handler);
    }, [confirmDelete]);

    const downloadSelected = useCallback(async () => {
        if (selectedImages.length === 0) return;
        setDownloading(true);
        try {
            const zip = new JSZip();
            await Promise.all(selectedImages.map(async (url) => {
                try {
                    const fetchUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;
                    const response = await fetch(fetchUrl);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const blob = await response.blob();
                    const filename = decodeURIComponent(url.split('/').pop() || 'asset');
                    zip.file(filename, blob);
                } catch (error) {
                    console.error('Failed to fetch image:', url, error);
                }
            }));
            const content = await zip.generateAsync({ type: 'blob' });
            FileSaver.saveAs(content, 'comfy-ui-gallery-assets.zip');
            message.success(`Downloaded ${selectedImages.length} asset${selectedImages.length === 1 ? '' : 's'}`);
        } catch (error) {
            message.error('Failed to download selected assets');
        } finally {
            setDownloading(false);
        }
    }, [message, selectedImages]);

    const addSelectedToGraph = useCallback(() => {
        const images = galleryImagesFromSelection(selectableImages, selectedImages);
        if (images.length === 0) {
            message.warning('Select at least one image, video or audio asset');
            return;
        }
        const result = addGalleryImagesToGraph(images, settings.relativePath);
        if (result.ok) {
            message.success(`Added ${result.added} asset${result.added === 1 ? '' : 's'} to the active graph`);
        } else {
            message.error(result.error || 'Could not add the images to the graph');
        }
    }, [message, selectableImages, selectedImages, settings.relativePath]);

    if (count === 0) return null;

    const toolbar = (
        <div
            className={`gallery-selection-toolbar${overlay ? ` gallery-selection-toolbar-overlay ${galleryThemeClass(effectiveDarkMode)}` : ''}`}
            style={overlay ? { position: 'fixed', zIndex: 2147483000 } : undefined}
            onClick={(event) => event.stopPropagation()}
        >
            <span className="gallery-selection-count">{count} selected</span>
            {count < selectableImages.length && (
                <Tooltip title="Select all visible assets (Ctrl+A)">
                    <Button size="small" icon={<CheckSquareOutlined />} onClick={selectAllVisible}>
                        Select all
                    </Button>
                </Tooltip>
            )}
            <Tooltip title="Add selected assets to the active graph">
                <Button
                    size="small"
                    icon={<PlusSquareOutlined />}
                    onClick={addSelectedToGraph}
                >
                    Add to graph
                </Button>
            </Tooltip>
            <Button
                size="small"
                icon={<DownloadOutlined />}
                loading={downloading}
                onClick={downloadSelected}
            >
                Download
            </Button>
            <Button
                size="small"
                danger
                type="primary"
                icon={<DeleteOutlined />}
                onClick={confirmDelete}
            >
                Delete
            </Button>
            <Tooltip title="Clear selection (Esc)">
                <Button size="small" type="text" icon={<CloseOutlined />} onClick={clearSelection} aria-label="Clear selection" />
            </Tooltip>
        </div>
    );

    return overlay ? createPortal(toolbar, document.body) : toolbar;
};

export default SelectionToolbar;
