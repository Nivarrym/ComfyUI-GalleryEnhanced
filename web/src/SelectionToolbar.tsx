import { useCallback, useEffect, useState } from 'react';
import { App, Button, Tooltip } from 'antd';
import DeleteOutlined from '@ant-design/icons/lib/icons/DeleteOutlined';
import DownloadOutlined from '@ant-design/icons/lib/icons/DownloadOutlined';
import CheckSquareOutlined from '@ant-design/icons/lib/icons/CheckSquareOutlined';
import CloseOutlined from '@ant-design/icons/lib/icons/CloseOutlined';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';

/**
 * Floating selection actions: batch download, batch delete, select all, clear.
 * The same delete flow is triggered by the Delete/Backspace keyboard shortcut.
 */
const SelectionToolbar = () => {
    const {
        selectedImages,
        selectableImages,
        selectAllVisible,
        clearSelection,
        deleteAssets,
    } = useGalleryContext();
    const { modal, message } = App.useApp();
    const [downloading, setDownloading] = useState(false);

    const count = selectedImages.length;

    const confirmDelete = useCallback(() => {
        if (selectedImages.length === 0) return;
        const urls = [...selectedImages];
        modal.confirm({
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
    }, [deleteAssets, message, modal, selectedImages]);

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

    if (count === 0) return null;

    return (
        <div className="gallery-selection-toolbar selectedImagesActionButton" onClick={(event) => event.stopPropagation()}>
            <span className="gallery-selection-count">{count} selected</span>
            {count < selectableImages.length && (
                <Tooltip title="Select all visible assets (Ctrl+A)">
                    <Button size="small" icon={<CheckSquareOutlined />} onClick={selectAllVisible}>
                        Select all
                    </Button>
                </Tooltip>
            )}
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
};

export default SelectionToolbar;
