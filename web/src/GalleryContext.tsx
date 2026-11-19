import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useSize from 'ahooks/lib/useSize';
import useRequest from 'ahooks/lib/useRequest/src/useRequest';
import { useEventListener, useLocalStorageState } from 'ahooks';
import type { AutoCompleteProps } from 'antd/es/auto-complete';
import type { DeleteResult } from './ComfyAppApi';
import { ComfyAppApi, BASE_PATH, OPEN_BUTTON_ID } from './ComfyAppApi';
import type { FileDetails, FilesTree } from './types';
import { hasMetadata } from './types';
import { perfMark, perfMeasure, setPerfEnabled } from './perf';

export interface SettingsState {
    relativePath: string;
    buttonBoxQuery: string;
    buttonLabel: string;
    showDateDivider: boolean;
    floatingButton: boolean;
    autoPlayVideos: boolean;
    hideOpenButton: boolean;
    darkMode: boolean;
    galleryShortcut: boolean;
    expandAllFolders: boolean;
    disableLogs: boolean;
    usePollingObserver: boolean;
    scanExtensions: string[];
    imageThumbFit: 'width' | 'height';
    videoThumbFit: 'width' | 'height';
    deduplicateSymlinks: boolean;
    debugPerf: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
    relativePath: './',
    buttonBoxQuery: 'div.flex.gap-2.mx-2',
    buttonLabel: 'Open Gallery',
    showDateDivider: true,
    floatingButton: true,
    autoPlayVideos: true,
    hideOpenButton: false,
    darkMode: false,
    galleryShortcut: true,
    expandAllFolders: true,
    disableLogs: false,
    usePollingObserver: false,
    scanExtensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'gif', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'flac', 'obj', 'glb', 'gltf', 'fbx', 'stl', 'usd', 'usdz'],
    imageThumbFit: 'width',
    videoThumbFit: 'height',
    deduplicateSymlinks: true,
    debugPerf: false,
};

export const STORAGE_KEY = 'comfy-ui-gallery-settings';

const FORCE_PERF = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('galleryPerf') === '1';

export interface ScanInfo {
    scanMs?: number;
    cache?: string;
    files?: number;
    fetchMs?: number;
    at: number;
}

export interface SelectionModifiers {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
}

export interface GalleryContextType {
    currentFolder: string;
    setCurrentFolder: Dispatch<SetStateAction<string>>;
    searchFileName: string;
    setSearchFileName: Dispatch<SetStateAction<string>>;
    showSettings: boolean;
    setShowSettings: Dispatch<SetStateAction<boolean>>;
    showRawMetadata: boolean;
    setShowRawMetadata: Dispatch<SetStateAction<boolean>>;
    showPerf: boolean;
    setShowPerf: Dispatch<SetStateAction<boolean>>;
    sortMethod: 'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓';
    setSortMethod: Dispatch<SetStateAction<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>>;
    imageInfoName: string | undefined;
    setImageInfoName: Dispatch<SetStateAction<string | undefined>>;
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    previewingVideo: string | undefined;
    setPreviewingVideo: Dispatch<SetStateAction<string | undefined>>;
    size: ReturnType<typeof useSize>;
    imagesBoxSize: ReturnType<typeof useSize>;
    data: FilesTree | undefined;
    dataRevision: number;
    error: any;
    loading: boolean;
    runAsync: () => Promise<any>;
    mutate: (data?: FilesTree | ((oldData?: FilesTree | undefined) => FilesTree | undefined) | undefined) => void;
    gridSize: { width: number; height: number; columnCount: number; rowCount: number };
    setGridSize: Dispatch<SetStateAction<{ width: number; height: number; columnCount: number; rowCount: number }>>;
    autoSizer: { width: number; height: number };
    setAutoSizer: Dispatch<SetStateAction<{ width: number; height: number }>>;
    imagesDetailsList: FileDetails[];
    selectableImages: FileDetails[];
    imagesUrlsLists: string[];
    imagesAutoCompleteNames: NonNullable<AutoCompleteProps['options']>;
    autoCompleteOptions: NonNullable<AutoCompleteProps['options']>;
    setAutoCompleteOptions: React.Dispatch<React.SetStateAction<NonNullable<AutoCompleteProps['options']>>>;
    settings: SettingsState;
    setSettings: (v: SettingsState) => void;
    selectedImages: string[];
    selectedSet: Set<string>;
    setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
    selectionAnchor: string | undefined;
    selectImage: (url: string, modifiers?: SelectionModifiers) => void;
    selectRange: (url: string) => void;
    selectAllVisible: () => void;
    clearSelection: () => void;
    removeAssets: (urls: string[]) => void;
    deleteAssets: (urls: string[]) => Promise<DeleteResult>;
    scanInfo: ScanInfo | undefined;
    siderCollapsed: boolean;
    setSiderCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

function mergeSettings(base: SettingsState, incoming: any): SettingsState {
    const merged: SettingsState = { ...base };
    if (incoming && typeof incoming === 'object') {
        (Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[]).forEach((key) => {
            const value = incoming[key];
            if (value !== null && value !== undefined) {
                (merged as any)[key] = value;
            }
        });
    }
    return merged;
}

function monitorKey(settings: SettingsState): string {
    return JSON.stringify([
        settings.relativePath,
        settings.disableLogs,
        settings.usePollingObserver,
        settings.scanExtensions,
        settings.deduplicateSymlinks,
    ]);
}

export function GalleryProvider({ children }: { children: React.ReactNode }) {
    const [currentFolder, setCurrentFolder] = useState("output");
    const [searchFileName, setSearchFileName] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [showRawMetadata, setShowRawMetadata] = useState(false);
    const [showPerf, setShowPerf] = useState(false);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>(undefined);
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const [scanInfo, setScanInfo] = useState<ScanInfo | undefined>(undefined);
    const [dataRevision, setDataRevision] = useState(0);
    const size = useSize(document.querySelector('body'));
    const imagesBoxSize = useSize(document.querySelector('#imagesBox'));
    const [gridSize, setGridSize] = useState({ width: 1000, height: 600, columnCount: 1, rowCount: 1 });
    const [autoSizer, setAutoSizer] = useState({ width: 1000, height: 600 });
    const [autoCompleteOptions, setAutoCompleteOptions] = useState<NonNullable<AutoCompleteProps['options']>>([]);
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });

    const mergedSettings = useMemo<SettingsState>(() => mergeSettings(DEFAULT_SETTINGS, settingsState), [settingsState]);
    const settingsRef = useRef<SettingsState>(mergedSettings);
    const bootstrappedRef = useRef(false);
    const appliedMonitorKeyRef = useRef<string>('');
    const anchorRef = useRef<string | undefined>(undefined);

    useEffect(() => {
        settingsRef.current = mergedSettings;
    }, [mergedSettings]);

    useEffect(() => {
        anchorRef.current = selectionAnchor;
    }, [selectionAnchor]);

    const getImages = useCallback(async () => {
        const start = perfMark('images.fetch.start');
        const relativePath = settingsRef.current.relativePath;
        try {
            const request = await ComfyAppApi.fetchImages(relativePath);
            const scanMs = Number(request.headers?.get('X-Gallery-Scan-Ms') ?? NaN);
            const cache = request.headers?.get('X-Gallery-Scan-Cache') ?? undefined;
            const files = Number(request.headers?.get('X-Gallery-File-Count') ?? NaN);
            const networkMs = perfMeasure('images.fetch.network', start, { relativePath });
            const json: FilesTree = await request.json();
            const fetchMs = perfMeasure('images.fetch', start, {
                relativePath,
                networkMs: Math.round(networkMs),
                scanMs: Number.isFinite(scanMs) ? scanMs : undefined,
                cache,
                files: Number.isFinite(files) ? files : undefined,
            });
            setScanInfo({
                scanMs: Number.isFinite(scanMs) ? scanMs : undefined,
                cache,
                files: Number.isFinite(files) ? files : undefined,
                fetchMs,
                at: Date.now(),
            });
            perfMark('data.ready');
            setDataRevision((revision) => revision + 1);
            return json;
        } catch (error) {
            perfMeasure('images.fetch.error', start, { relativePath });
            throw error;
        }
    }, []);

    const { data, error, loading, runAsync, mutate } = useRequest(getImages, { manual: true });

    const updateImages = useCallback((changes: any) => {
        if (!changes || !changes.folders) {
            console.warn("No valid changes data received.");
            return;
        }
        mutate((oldData: FilesTree | undefined) => {
            if (!oldData || !oldData.folders) return oldData;
            const folders = { ...oldData.folders };
            let changed = false;
            for (const folderName in changes.folders) {
                const folderChanges = changes.folders[folderName];
                if (!folders[folderName] && folderChanges) {
                    folders[folderName] = {};
                }
                if (folders[folderName]) {
                    for (const filename in folderChanges) {
                        const fileChange = folderChanges[filename];
                        switch (fileChange.action) {
                            case 'create':
                                folders[folderName] = {
                                    ...(folders[folderName] || {}),
                                    [filename]: { ...fileChange },
                                };
                                changed = true;
                                break;
                            case 'update':
                                if (folders[folderName][filename]) {
                                    const incoming = { ...fileChange };
                                    // Watchdog updates are lightweight: keep metadata that was
                                    // loaded lazily by MetadataView instead of wiping it.
                                    if (incoming.metadata && Object.keys(incoming.metadata).length === 0) {
                                        const existing = folders[folderName][filename].metadata;
                                        if (hasMetadata({ metadata: existing })) {
                                            incoming.metadata = existing;
                                        }
                                    }
                                    folders[folderName] = {
                                        ...folders[folderName],
                                        [filename]: { ...folders[folderName][filename], ...incoming },
                                    };
                                    changed = true;
                                }
                                break;
                            case 'remove':
                                if (folders[folderName][filename]) {
                                    const nextFolder = { ...folders[folderName] };
                                    delete nextFolder[filename];
                                    if (Object.keys(nextFolder).length === 0) {
                                        delete folders[folderName];
                                    } else {
                                        folders[folderName] = nextFolder;
                                    }
                                    changed = true;
                                }
                                break;
                            default:
                                console.warn(`Unknown action: ${fileChange.action}`);
                        }
                    }
                } else {
                    console.warn(`Change for non-existent folder: ${folderName}`);
                    return oldData;
                }
            }
            if (changed) {
                return { ...oldData, folders };
            }
            return oldData;
        });
    }, [mutate]);

    // Bootstrap once: server settings -> monitor -> first listing.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const start = perfMark('gallery.bootstrap');
            try {
                const serverSettings = await ComfyAppApi.fetchSettings();
                if (cancelled) return;
                const merged = mergeSettings(DEFAULT_SETTINGS, { ...(settingsState ?? {}), ...serverSettings });
                perfMeasure('settings.fetch', start, { keys: Object.keys(serverSettings || {}).length });
                setSettings(merged);
                settingsRef.current = merged;
                setPerfEnabled(FORCE_PERF || merged.debugPerf);
                appliedMonitorKeyRef.current = monitorKey(merged);

                try {
                    await ComfyAppApi.startMonitoring(
                        merged.relativePath,
                        merged.disableLogs,
                        merged.usePollingObserver,
                        merged.scanExtensions,
                        merged.deduplicateSymlinks,
                        merged.debugPerf,
                    );
                } catch (monitorError) {
                    console.warn('Gallery: failed to start monitoring', monitorError);
                }

                ComfyAppApi.onFileChange((event) => {
                    updateImages(event.detail);
                });
                ComfyAppApi.onUpdate((event) => {
                    updateImages(event.detail);
                });
                ComfyAppApi.onClear(() => {
                    mutate({ folders: {} });
                });

                await runAsync();
                perfMeasure('gallery.bootstrap', start);
                bootstrappedRef.current = true;
                perfMark('gallery.ready');
            } catch (bootstrapError) {
                perfMeasure('gallery.bootstrap.error', start);
                console.error('Gallery: bootstrap failed', bootstrapError);
            }
        })();
        return () => { cancelled = true; };
        // Intentionally once per mount; settings changes are handled by the effect below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Restart monitoring and refresh when scan-related settings change (after bootstrap).
    const currentMonitorKey = monitorKey(mergedSettings);
    useEffect(() => {
        if (!bootstrappedRef.current) return;
        if (currentMonitorKey === appliedMonitorKeyRef.current) return;
        appliedMonitorKeyRef.current = currentMonitorKey;
        const s = settingsRef.current;
        ComfyAppApi.startMonitoring(
            s.relativePath,
            s.disableLogs,
            s.usePollingObserver,
            s.scanExtensions,
            s.deduplicateSymlinks,
            s.debugPerf,
        ).then(() => runAsync()).catch((monitorError: unknown) => {
            console.warn('Gallery: failed to restart monitoring', monitorError);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentMonitorKey]);

    useEffect(() => {
        setPerfEnabled(FORCE_PERF || !!mergedSettings.debugPerf);
    }, [mergedSettings.debugPerf]);

    // Keep the folder tree usable when the selected folder disappears.
    useEffect(() => {
        if (data && data.folders) {
            const keys = Object.keys(data.folders);
            if (keys.length > 0 && !data.folders[currentFolder]) {
                setCurrentFolder(keys.sort()[0]);
            }
        }
    }, [data, currentFolder]);

    // Selection is scoped to a folder.
    useEffect(() => {
        setSelectedImages([]);
        setSelectionAnchor(undefined);
    }, [currentFolder]);

    const imagesDetailsList = useMemo(() => {
        let list: FileDetails[] = Object.values(data?.folders?.[currentFolder] ?? {});
        if (searchFileName && searchFileName.trim() !== "") {
            const searchTerm = searchFileName.toLowerCase();
            list = list.filter(imageInfo => imageInfo.name.toLowerCase().includes(searchTerm));
        }
        if (sortMethod !== 'Name ↑' && sortMethod !== 'Name ↓') {
            list = list.sort((a, b) => (sortMethod === 'Newest' ? (b.timestamp || 0) - (a.timestamp || 0) : (a.timestamp || 0) - (b.timestamp || 0)));
            if (!mergedSettings.showDateDivider) return list;
            const grouped: { [date: string]: FileDetails[] } = {};
            list.forEach(item => {
                const date = item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(item);
            });
            const result: FileDetails[] = [];
            Object.entries(grouped).forEach(([date, items]) => {
                const colCount = Math.max(1, gridSize.columnCount || 1);
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
        }
        switch (sortMethod) {
            case 'Name ↑':
                return list.sort((a, b) => a.name.localeCompare(b.name));
            case 'Name ↓':
                return list.sort((a, b) => b.name.localeCompare(a.name));
            default:
                return list;
        }
    }, [currentFolder, data, sortMethod, searchFileName, gridSize.columnCount, mergedSettings.showDateDivider]);

    const selectableImages = useMemo(
        () => imagesDetailsList.filter(image => image.type !== 'divider' && image.type !== 'empty-space'),
        [imagesDetailsList]
    );

    const selectedSet = useMemo(() => new Set(selectedImages), [selectedImages]);

    const imagesUrlsLists = useMemo(
        () => selectableImages.map(image => `${BASE_PATH}${image.url}`),
        [selectableImages]
    );

    const imagesAutoCompleteNames = useMemo<NonNullable<AutoCompleteProps['options']>>(() => {
        const filtered = [...selectableImages].filter(image => typeof image.name === 'string');
        if (sortMethod === 'Name ↑') {
            filtered.sort((a, b) => (a.name as string).localeCompare(b.name as string));
        } else if (sortMethod === 'Name ↓') {
            filtered.sort((a, b) => (b.name as string).localeCompare(a.name as string));
        } else if (sortMethod === 'Newest') {
            filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } else if (sortMethod === 'Oldest') {
            filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        return filtered.map(image => ({ value: image.name as string, label: image.name as string }));
    }, [selectableImages, sortMethod]);

    // Drop stale selections when files disappear because of external changes.
    useEffect(() => {
        if (selectedImages.length === 0) return;
        const alive = new Set(selectableImages.map(image => image.url));
        const next = selectedImages.filter(url => alive.has(url));
        if (next.length !== selectedImages.length) {
            setSelectedImages(next);
            if (anchorRef.current && !alive.has(anchorRef.current)) {
                setSelectionAnchor(undefined);
            }
        }
    }, [selectableImages, selectedImages]);

    const selectRange = useCallback((url: string) => {
        const urls = selectableImages.map(image => image.url);
        const anchor = anchorRef.current ?? url;
        const from = urls.indexOf(anchor);
        const to = urls.indexOf(url);
        if (from < 0 || to < 0) {
            setSelectedImages([url]);
            if (!anchorRef.current) setSelectionAnchor(url);
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        setSelectedImages(urls.slice(lo, hi + 1));
        if (!anchorRef.current) setSelectionAnchor(url);
    }, [selectableImages]);

    const selectImage = useCallback((url: string, modifiers: SelectionModifiers = {}) => {
        if (modifiers.shift) {
            selectRange(url);
            return;
        }
        if (modifiers.ctrl || modifiers.meta) {
            setSelectedImages((previous) => (
                previous.includes(url)
                    ? previous.filter(selected => selected !== url)
                    : [...previous, url]
            ));
            setSelectionAnchor(url);
            return;
        }
        // Plain click: keep a multi-selection when clicking inside it, otherwise
        // select just this asset. The preview still opens on a plain click.
        setSelectedImages((previous) => (previous.includes(url) ? previous : [url]));
        setSelectionAnchor(url);
    }, [selectRange]);

    const selectAllVisible = useCallback(() => {
        setSelectedImages(selectableImages.map(image => image.url));
    }, [selectableImages]);

    const clearSelection = useCallback(() => {
        setSelectedImages([]);
        setSelectionAnchor(undefined);
    }, []);

    const removeAssets = useCallback((urls: string[]) => {
        if (urls.length === 0) return;
        const removed = new Set(urls);
        mutate((oldData: FilesTree | undefined) => {
            if (!oldData || !oldData.folders) return oldData;
            const folders: Record<string, any> = { ...oldData.folders };
            let changed = false;
            for (const folderName of Object.keys(folders)) {
                const folder = folders[folderName];
                if (!folder) continue;
                const folderCopy = { ...folder };
                let folderChanged = false;
                for (const filename of Object.keys(folderCopy)) {
                    if (removed.has(folderCopy[filename]?.url)) {
                        delete folderCopy[filename];
                        folderChanged = true;
                    }
                }
                if (folderChanged) {
                    changed = true;
                    if (Object.keys(folderCopy).length === 0) {
                        delete folders[folderName];
                    } else {
                        folders[folderName] = folderCopy;
                    }
                }
            }
            return changed ? { ...oldData, folders } : oldData;
        });
        setSelectedImages(previous => previous.filter(url => !removed.has(url)));
        if (anchorRef.current && removed.has(anchorRef.current)) {
            setSelectionAnchor(undefined);
        }
    }, [mutate]);

    const deleteAssets = useCallback(async (urls: string[]): Promise<DeleteResult> => {
        const result = await ComfyAppApi.deleteImages(urls);
        const requested = new Set(urls);
        const knownDeleted = (result.deleted || []).filter(url => requested.has(url));
        const deleted = knownDeleted.length > 0
            ? knownDeleted
            : (result.failed.length === 0 ? urls : []);
        if (deleted.length > 0) {
            removeAssets(deleted);
        }
        return { ...result, deleted };
    }, [removeAssets]);

    const saveSettings = useCallback((newSettings: SettingsState) => {
        setPerfEnabled(FORCE_PERF || !!newSettings.debugPerf);
        setSettings(newSettings);
        ComfyAppApi.saveSettings(newSettings);
    }, [setSettings]);

    useEventListener('keydown', (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
        if (mergedSettings.galleryShortcut && event.code === "KeyG" && (event.ctrlKey || event.metaKey)) {
            try {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                document.getElementById(OPEN_BUTTON_ID)?.click();
            } catch { }
            return;
        }
        if (!open || typing) return;
        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyA') {
            event.preventDefault();
            selectAllVisible();
            return;
        }
        const anotherModalOpen = () => Array.from(document.querySelectorAll<HTMLElement>('.ant-modal-wrap'))
            .filter((element) => element.getAttribute('style')?.includes('display: none') !== true && getComputedStyle(element).display !== 'none')
            .length > 1;
        if (event.code === 'Escape' && selectedImages.length > 0) {
            // Image preview and nested modals own their Escape handling.
            if (document.querySelector('.ant-image-preview-root')) return;
            if (anotherModalOpen()) return;
            event.preventDefault();
            clearSelection();
            return;
        }
        if (event.code === 'Escape') {
            if (document.querySelector('.ant-image-preview-root')) return;
            if (anotherModalOpen()) return;
            setOpen(false);
            return;
        }
        if ((event.code === 'Delete' || event.code === 'Backspace') && selectedImages.length > 0) {
            event.preventDefault();
            window.dispatchEvent(new CustomEvent('gallery:delete-selected'));
        }
    });

    const value = useMemo(() => ({
        currentFolder, setCurrentFolder,
        searchFileName, setSearchFileName,
        showSettings, setShowSettings,
        showRawMetadata, setShowRawMetadata,
        showPerf, setShowPerf,
        sortMethod, setSortMethod,
        imageInfoName, setImageInfoName,
        open, setOpen,
        previewingVideo, setPreviewingVideo,
        size, imagesBoxSize,
        data, dataRevision, error, loading, runAsync, mutate,
        gridSize, setGridSize,
        autoSizer, setAutoSizer,
        imagesDetailsList,
        selectableImages,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        setAutoCompleteOptions,
        settings: mergedSettings,
        setSettings: saveSettings,
        selectedImages,
        selectedSet,
        setSelectedImages,
        selectionAnchor,
        selectImage,
        selectRange,
        selectAllVisible,
        clearSelection,
        removeAssets,
        deleteAssets,
        scanInfo,
        siderCollapsed,
        setSiderCollapsed,
    }), [
        currentFolder,
        searchFileName,
        showSettings,
        showRawMetadata,
        showPerf,
        sortMethod,
        imageInfoName,
        open,
        previewingVideo,
        size,
        imagesBoxSize,
        data,
        dataRevision,
        error,
        loading,
        runAsync,
        mutate,
        gridSize,
        autoSizer,
        imagesDetailsList,
        selectableImages,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        mergedSettings,
        saveSettings,
        selectedImages,
        selectedSet,
        selectionAnchor,
        selectImage,
        selectRange,
        selectAllVisible,
        clearSelection,
        removeAssets,
        deleteAssets,
        scanInfo,
        siderCollapsed,
    ]);

    return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}

export function useGalleryContext() {
    const ctx = useContext(GalleryContext);
    if (!ctx) throw new Error('useGalleryContext must be used within a GalleryProvider');
    return ctx;
}
