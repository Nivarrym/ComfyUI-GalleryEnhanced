import { theme, type ThemeConfig } from 'antd';

export type GalleryThemeName = 'light' | 'dark';

/**
 * Ant Design theme for the gallery. CSS variables for custom (non-antd) surfaces
 * live in gallery.css and are applied through `.gallery-theme-dark` / `-light`.
 */
export function getGalleryTheme(dark: boolean): ThemeConfig {
    return {
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
            colorPrimary: '#1890ff',
            colorInfo: '#1890ff',
            borderRadius: 8,
            fontSize: 14,
            colorBgLayout: dark ? '#141414' : '#f5f5f5',
            colorBgContainer: dark ? '#1f1f1f' : '#ffffff',
            colorBgElevated: dark ? '#262626' : '#ffffff',
        },
        components: {
            Modal: {
                contentBg: dark ? '#141414' : '#ffffff',
                headerBg: dark ? '#141414' : '#ffffff',
                titleColor: dark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)',
            },
            Layout: {
                bodyBg: 'transparent',
                headerBg: 'transparent',
                siderBg: 'transparent',
            },
            Tree: {
                nodeHoverBg: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                nodeSelectedBg: dark ? 'rgba(24,144,255,0.24)' : 'rgba(24,144,255,0.12)',
            },
            Segmented: {
                itemSelectedBg: dark ? '#262626' : '#ffffff',
            },
            Input: {
                colorBgContainer: dark ? '#1f1f1f' : '#ffffff',
            },
        },
    };
}

export function galleryThemeClass(dark: boolean): string {
    return `gallery-theme ${dark ? 'gallery-theme-dark' : 'gallery-theme-light'}`;
}
