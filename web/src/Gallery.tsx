import { ConfigProvider } from 'antd';
import App from 'antd/es/app/App';
import { GalleryProvider, useGalleryContext } from './GalleryContext';
import GalleryOpenButton from './GalleryOpenButton';
import GalleryModal from './GalleryModal';
import { ModelThumbnailProvider } from './GlobalModelRenderer';
import { getGalleryTheme, galleryThemeClass } from './theme';

function GalleryShell() {
    const { settings } = useGalleryContext();
    return (
        <div className={galleryThemeClass(settings.darkMode)}>
            <ConfigProvider theme={getGalleryTheme(settings.darkMode)}>
                <App>
                    <ModelThumbnailProvider>
                        <GalleryOpenButton />
                        <GalleryModal />
                    </ModelThumbnailProvider>
                </App>
            </ConfigProvider>
        </div>
    );
}

function Gallery() {
    return (
        <GalleryProvider>
            <GalleryShell />
        </GalleryProvider>
    );
}

export default Gallery;
