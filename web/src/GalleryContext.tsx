import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useSize from 'ahooks/lib/useSize';
import useRequest from 'ahooks/lib/useRequest/src/useRequest';
import { useEventListener, useLocalStorageState } from 'ahooks';
import type { AutoCompleteProps } from 'antd/es/auto-complete';
import type { DeleteResult } from './ComfyAppApi';
import { ComfyAppApi, OPEN_BUTTON_ID } from './ComfyAppApi';
import type { FileDetails, FilesTree, AssetTagState } from './types';
import { hasMetadata } from './types';
import { assetUrl } from './assetUrls';
import { perfMark, perfMeasure, setPerfEnabled } from './perf';

export type PageMode = 'endless' | 20 | 40 | 60 | 100 | 200;
export type PreviewMode = 'selection' | 'plain' | null;
export type AssetFilter = 'none' | 'favorite' | 'trash';

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
    skipTrashWhenAdvancing: boolean;
    thumbSize: number;
    sidebarWidth: number;
    pageMode: PageMode;
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
    skipTrashWhenAdvancing: true,
    thumbSize: 350,
    sidebarWidth: 320,
    pageMode: 'endless',
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
    previewMode: PreviewMode;
    setPreviewMode: (mode: PreviewMode) => void;
    getPreviewMode: () => PreviewMode;
    previewAssetUrl: string | undefined;
    setPreviewAssetUrl: Dispatch<SetStateAction<string | undefined>>;
    hoveredAssetUrl: string | undefined;
    setHoveredAssetUrl: Dispatch<SetStateAction<string | undefined>>;
    assetTags: Record<string, AssetTagState>;
    isAssetTrashed: (url: string) => boolean;
    isAssetFavorite: (url: string) => boolean;
    toggleAssetTag: (url: string, tag: 'trash' | 'favorite') => boolean;
    toggleAssetTagForUrls: (urls: string[], tag: 'trash' | 'favorite') => boolean;
    assetFilter: AssetFilter;
    setAssetFilter: Dispatch<SetStateAction<AssetFilter>>;
    size: ReturnType<typeof useSize>;
    imagesBoxSize: ReturnType<typeof useSize>;
    data: FilesTree | undefined;
    dataRevision: number;
    error: any;
    loading: boolean;
    runAsync: () => Promise<any>;
    mutate: (data?: FilesTree | ((oldData?: FilesTree | undefined) => FilesTree | undefined) | undefined) => void;
    imagesDetailsList: FileDetails[];
    selectableImages: FileDetails[];
    imagesUrlsLists: string[];
    imagesAutoCompleteNames: NonNullable<AutoCompleteProps['options']>;
    autoCompleteOptions: NonNullable<AutoCompleteProps['options']>;
    setAutoCompleteOptions: React.Dispatch<React.SetStateAction<NonNullable<AutoCompleteProps['options']>>>;
    settings: SettingsState;
    setSettings: (v: SettingsState) => void;
    themePreview: boolean | null;
    setThemePreview: Dispatch<SetStateAction<boolean | null>>;
    effectiveDarkMode: boolean;
    pageMode: PageMode;
    setPageMode: (mode: PageMode) => void;
    pageIndex: number;
    setPageIndex: Dispatch<SetStateAction<number>>;
    pageCount: number;
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
    const [themePreview, setThemePreview] = useState<boolean | null>(null);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [pageIndex, setPageIndex] = useState(0);
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [previewMode, setPreviewModeState] = useState<PreviewMode>(null);
    const previewModeRef = useRef<PreviewMode>(null);
    const [previewAssetUrl, setPreviewAssetUrl] = useState<string | undefined>(undefined);
    const [hoveredAssetUrl, setHoveredAssetUrl] = useState<string | undefined>(undefined);
    const [assetFilter, setAssetFilter] = useState<AssetFilter>('none');
    const setPreviewMode = useCallback((mode: PreviewMode) => {
        // Keep a synchronous copy: Ant preview can fire onChange before React
        // commits the state update from a card action.
        previewModeRef.current = mode;
        setPreviewModeState(mode);
    }, []);
    const getPreviewMode = useCallback(() => previewModeRef.current, []);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [selectionAnchor, setSelectionAnchor] = useState<string | undefined>(undefined);
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const [scanInfo, setScanInfo] = useState<ScanInfo | undefined>(undefined);
    const [dataRevision, setDataRevision] = useState(0);
    const size = useSize(document.querySelector('body'));
    const imagesBoxSize = useSize(document.querySelector('#imagesBox'));
    const [autoCompleteOptions, setAutoCompleteOptions] = useState<NonNullable<AutoCompleteProps['options']>>([]);
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });
    const [assetTags, setAssetTags] = useLocalStorageState<Record<string, AssetTagState>>('comfy-ui-gallery-asset-tags', {
        defaultValue: {},
    });

    const mergedSettings = useMemo<SettingsState>(() => mergeSettings(DEFAULT_SETTINGS, settingsState), [settingsState]);
    const effectiveDarkMode = themePreview ?? !!mergedSettings.darkMode;
    const settingsRef = useRef<SettingsState>(mergedSettings);
    const bootstrappedRef = useRef(false);
    const forceRefreshRef = useRef(false);
    const openRefreshRef = useRef(false);
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
            const forceRefresh = forceRefreshRef.current;
            forceRefreshRef.current = false;
            const request = await ComfyAppApi.fetchImages(relativePath, forceRefresh);
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

    // A monolithic SPA may keep the gallery mounted for hours. Re-read the
    // listing whenever it is opened so newly generated files and deletions are
    // visible even if a monitor event was missed.
    useEffect(() => {
        if (!open) {
            openRefreshRef.current = false;
            return;
        }
        if (!bootstrappedRef.current || openRefreshRef.current) return;
        openRefreshRef.current = true;
        forceRefreshRef.current = true;
        runAsync().catch((refreshError: unknown) => {
            console.warn('Gallery: failed to refresh on open', refreshError);
        });
    }, [open, runAsync]);

    // A theme toggle in the settings dialog is a live preview; never leak it
    // outside the dialog or into the persisted settings.
    useEffect(() => {
        if (!open) setThemePreview(null);
    }, [open]);

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

    const isAssetTrashed = useCallback((url: string) => !!assetTags?.[url]?.trash, [assetTags]);
    const isAssetFavorite = useCallback((url: string) => !!assetTags?.[url]?.favorite, [assetTags]);

    const toggleAssetTag = useCallback((url: string, tag: 'trash' | 'favorite') => {
        const active = !!assetTags?.[url]?.[tag];
        setAssetTags((previous) => {
            const next = { ...(previous ?? {}) };
            const entry = { ...(next[url] ?? {}) };
            if (active) {
                delete entry[tag];
            } else {
                entry[tag] = true;
            }
            if (entry.trash || entry.favorite) {
                next[url] = entry;
            } else {
                delete next[url];
            }
            return next;
        });
        return !active;
    }, [assetTags, setAssetTags]);

    const toggleAssetTagForUrls = useCallback((urls: string[], tag: 'trash' | 'favorite') => {
        const unique = Array.from(new Set(urls));
        if (unique.length === 0) return false;
        const shouldSet = !unique.every((url) => !!assetTags?.[url]?.[tag]);
        setAssetTags((previous) => {
            const next = { ...(previous ?? {}) };
            for (const url of unique) {
                const entry = { ...(next[url] ?? {}) };
                if (shouldSet) {
                    entry[tag] = true;
                } else {
                    delete entry[tag];
                }
                if (entry.trash || entry.favorite) {
                    next[url] = entry;
                } else {
                    delete next[url];
                }
            }
            return next;
        });
        return shouldSet;
    }, [assetTags, setAssetTags]);

    const imagesDetailsList = useMemo(() => {
        let list: FileDetails[] = Object.values(data?.folders?.[currentFolder] ?? {});
        if (searchFileName && searchFileName.trim() !== "") {
            const searchTerm = searchFileName.toLowerCase();
            list = list.filter(imageInfo => imageInfo.name.toLowerCase().includes(searchTerm));
        }
        if (assetFilter === 'favorite') {
            list = list.filter(imageInfo => !!assetTags?.[imageInfo.url]?.favorite);
        } else if (assetFilter === 'trash') {
            list = list.filter(imageInfo => !!assetTags?.[imageInfo.url]?.trash);
        }
        switch (sortMethod) {
            case 'Name ↑':
                return list.sort((a, b) => a.name.localeCompare(b.name));
            case 'Name ↓':
                return list.sort((a, b) => b.name.localeCompare(a.name));
            case 'Newest':
                return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            case 'Oldest':
            default:
                return list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
    }, [currentFolder, data, sortMethod, searchFileName, assetFilter, assetTags]);

    const pageMode: PageMode = mergedSettings.pageMode ?? 'endless';
    const pageCount = pageMode === 'endless'
        ? 1
        : Math.max(1, Math.ceil(imagesDetailsList.length / pageMode));

    useEffect(() => {
        setPageIndex(0);
    }, [currentFolder, searchFileName, sortMethod, pageMode, assetFilter]);

    useEffect(() => {
        setPageIndex((index) => Math.min(index, pageCount - 1));
    }, [pageCount]);

    const selectableImages = useMemo(
        () => imagesDetailsList.filter(image => image.type !== 'divider' && image.type !== 'empty-space'),
        [imagesDetailsList]
    );

    const selectedSet = useMemo(() => new Set(selectedImages), [selectedImages]);

    const imagesUrlsLists = useMemo(
        () => selectableImages.map(image => assetUrl(image)),
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
        setThemePreview(null);
        setPerfEnabled(FORCE_PERF || !!newSettings.debugPerf);
        setSettings(newSettings);
        ComfyAppApi.saveSettings(newSettings);
    }, [setSettings]);

    const setPageMode = useCallback((mode: PageMode) => {
        setPageIndex(0);
        saveSettings({ ...settingsRef.current, pageMode: mode });
    }, [saveSettings]);

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
        if (!event.repeat && (event.code === 'Space' || event.code === 'KeyF')) {
            const previewOpen = !!document.querySelector('.ant-image-preview-root');
            const targetUrls = previewOpen
                ? (previewAssetUrl ? [previewAssetUrl] : [])
                : (selectedImages.length > 0
                    ? selectedImages
                    : (hoveredAssetUrl ? [hoveredAssetUrl] : []));
            if (targetUrls.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const tag = event.code === 'Space' ? 'trash' : 'favorite';
            const result = targetUrls.length === 1
                ? toggleAssetTag(targetUrls[0], tag)
                : toggleAssetTagForUrls(targetUrls, tag);
            if (tag === 'trash' && previewOpen && result && targetUrls.length === 1) {
                window.dispatchEvent(new CustomEvent('gallery:preview-advance'));
            }
            return;
        }
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
            // A plain preview is a read-only viewer: Delete must not touch the
            // selection while it is open. Selection previews explicitly allow it.
            if (document.querySelector('.ant-image-preview-root') && previewModeRef.current !== 'selection') {
                event.preventDefault();
                return;
            }
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
        previewMode, setPreviewMode, getPreviewMode,
        previewAssetUrl, setPreviewAssetUrl,
        hoveredAssetUrl, setHoveredAssetUrl,
        assetTags: assetTags ?? {},
        isAssetTrashed, isAssetFavorite,
        toggleAssetTag, toggleAssetTagForUrls,
        assetFilter, setAssetFilter,
        size, imagesBoxSize,
        data, dataRevision, error, loading, runAsync, mutate,
        imagesDetailsList,
        selectableImages,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        setAutoCompleteOptions,
        settings: mergedSettings,
        setSettings: saveSettings,
        themePreview,
        setThemePreview,
        effectiveDarkMode,
        pageMode,
        setPageMode,
        pageIndex,
        setPageIndex,
        pageCount,
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
        previewMode,
        setPreviewMode,
        getPreviewMode,
        previewAssetUrl,
        hoveredAssetUrl,
        assetTags,
        isAssetTrashed,
        isAssetFavorite,
        toggleAssetTag,
        toggleAssetTagForUrls,
        assetFilter,
        size,
        imagesBoxSize,
        data,
        dataRevision,
        error,
        loading,
        runAsync,
        mutate,
        imagesDetailsList,
        selectableImages,
        imagesUrlsLists,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        mergedSettings,
        saveSettings,
        themePreview,
        effectiveDarkMode,
        pageMode,
        setPageMode,
        pageIndex,
        pageCount,
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

    return (
        <GalleryContext.Provider value={value}>
            {children}
        </GalleryContext.Provider>
    );
}

export function useGalleryContext() {
    const ctx = useContext(GalleryContext);
    if (!ctx) throw new Error('useGalleryContext must be used within a GalleryProvider');
    return ctx;
}
