export interface FileInfo {
    filename: string;
    resolution: string;
    date: string;
    size: string;
}

export interface Metadata {
    fileinfo: FileInfo;
    prompt?: any; 
    workflow?: any;
}

export interface FileDetails {
    name: string;
    url: string;
    timestamp: number;
    date: string;
    metadata: Metadata;
    type: "image" | "media" | "audio" | "3d" | "divider" | "empty-space";
    /** Per-file revision token (mtime_ns-size) used to bust browser caches. */
    version?: string;
}

/** True when an asset has real metadata (lazy loading returns `{}` initially). */
export function hasMetadata(image?: { metadata?: unknown } | null): boolean {
    const metadata = image?.metadata;
    return !!metadata && typeof metadata === 'object' && Object.keys(metadata as Record<string, unknown>).length > 0;
}

export interface FolderContent {
    [filename: string]: FileDetails;
}

export interface Folders {
    [folderName: string]: FolderContent;
}

export interface FilesTree {
    folders: Folders;
}
