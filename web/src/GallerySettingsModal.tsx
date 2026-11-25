import Modal from 'antd/es/modal/Modal';
import { Button, Input, Select, Switch, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useGalleryContext, type SettingsState } from './GalleryContext';
import { useSetState } from 'ahooks';
import { useEffect, useState } from 'react';
import { BASE_Z_INDEX } from './ComfyAppApi';
import {
    GithubOutlined,
    LineChartOutlined,
    MoonOutlined,
    SunOutlined,
} from '@ant-design/icons';
import { galleryThemeClass } from './theme';

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="gallery-settings-section">
            <div className="gallery-settings-section-title">{title}</div>
            {children}
        </section>
    );
}

function SettingToggle({
    label,
    description,
    checked,
    onChange,
    icon,
    checkedIcon,
    uncheckedIcon,
}: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    icon?: ReactNode;
    checkedIcon?: ReactNode;
    uncheckedIcon?: ReactNode;
}) {
    return (
        <div className="gallery-setting-toggle">
            <div className="gallery-setting-text">
                <span className="gallery-setting-label">
                    {icon}
                    {label}
                </span>
                {description && <span className="gallery-setting-desc">{description}</span>}
            </div>
            <Switch
                size="small"
                checked={checked}
                onChange={onChange}
                checkedChildren={checkedIcon}
                unCheckedChildren={uncheckedIcon}
            />
        </div>
    );
}

const GallerySettingsModal = () => {
    const { showSettings, setShowSettings, settings, setSettings, setShowPerf, effectiveDarkMode, setThemePreview } = useGalleryContext();
    // Staged (unsaved) settings
    const [staged, setStaged] = useSetState<SettingsState>(settings);
    const [extInput, setExtInput] = useState("");

    // When modal opens, reset staged to current settings
    useEffect(() => {
        if (showSettings) {
            setStaged(settings);
            setThemePreview(null);
            setExtInput((settings && (settings as any).scanExtensions) ? (settings as any).scanExtensions.join(', ') : "");
        }
    }, [showSettings, settings, setStaged, setThemePreview]);

    // Save staged settings to context and close
    const handleSave = () => {
        const exts = extInput.split(',').map(s => s.trim().replace(/^\./, '')).filter(s => s);
        const newSettings = { ...staged, scanExtensions: exts } as SettingsState;
        setThemePreview(null);
        setSettings(newSettings);
        setShowSettings(false);
    };
    // Cancel: just close modal (staged will reset on next open)
    const handleCancel = () => {
        setThemePreview(null);
        setShowSettings(false);
    };

    return (
        <Modal
            zIndex={BASE_Z_INDEX + 1}
            rootClassName={`gallery-settings-modal-root ${galleryThemeClass(effectiveDarkMode)}`}
            title={"Gallery settings"}
            open={showSettings}
            centered
            width={760}
            afterOpenChange={(open) => {
                setShowSettings(open);
                if (!open) setThemePreview(null);
            }}
            onOk={handleSave}
            onCancel={handleCancel}
            footer={(
                <div className="gallery-settings-footer">
                    <Button
                        type="link"
                        href="https://github.com/PanicTitan/ComfyUI-Gallery"
                        target="_blank"
                        icon={<GithubOutlined />}
                        style={{ paddingLeft: 0 }}
                    >
                        Upstream project
                    </Button>
                    <div>
                        <Button key="back" onClick={handleCancel}>Return</Button>
                        <Button key="submit" type="primary" onClick={handleSave} style={{ marginLeft: 8 }}>Save</Button>
                    </div>
                </div>
            )}
        >
            <div className="gallery-settings">
                <SettingsSection title="Appearance">
                    <div className="gallery-setting-grid">
                        <SettingToggle
                            label="Theme"
                            description={staged.darkMode ? 'Dark' : 'Light'}
                            icon={staged.darkMode ? <MoonOutlined /> : <SunOutlined />}
                            checked={staged.darkMode}
                            checkedIcon={<MoonOutlined />}
                            uncheckedIcon={<SunOutlined />}
                            onChange={checked => {
                                setStaged({ darkMode: checked });
                                setThemePreview(checked);
                            }}
                        />
                        <SettingToggle
                            label="Date dividers"
                            description="Group cards by date"
                            checked={staged.showDateDivider}
                            onChange={checked => setStaged({ showDateDivider: checked })}
                        />
                        <SettingToggle
                            label="Videos on hover"
                            description="Play looped previews"
                            checked={staged.autoPlayVideos}
                            onChange={checked => setStaged({ autoPlayVideos: checked })}
                        />
                        <SettingToggle
                            label="Floating button"
                            description="Draggable launcher"
                            checked={staged.floatingButton}
                            onChange={checked => setStaged({ floatingButton: checked })}
                        />
                        <SettingToggle
                            label="Hide open button"
                            description="Use Ctrl+G instead"
                            checked={staged.hideOpenButton}
                            onChange={checked => setStaged({ hideOpenButton: checked })}
                        />
                    </div>
                </SettingsSection>

                <div className="gallery-settings-split">
                    <SettingsSection title="Performance">
                        <div className="gallery-setting-grid single">
                            <SettingToggle
                                label="Debug performance"
                                description="Bootstrap / scan / thumbnail timings"
                                checked={staged.debugPerf}
                                onChange={checked => setStaged({ debugPerf: checked })}
                            />
                            <Button
                                size="small"
                                icon={<LineChartOutlined />}
                                onClick={() => {
                                    setShowSettings(false);
                                    setShowPerf(true);
                                }}
                            >
                                Open performance report
                            </Button>
                        </div>
                    </SettingsSection>

                    <SettingsSection title="Navigation">
                        <div className="gallery-setting-grid single">
                            <SettingToggle
                                label="Ctrl+G shortcut"
                                description="Open the gallery from anywhere"
                                checked={staged.galleryShortcut}
                                onChange={checked => setStaged({ galleryShortcut: checked })}
                            />
                            <SettingToggle
                                label="Skip trash when advancing"
                                description="After marking trash, preview jumps to the next unmarked image"
                                checked={staged.skipTrashWhenAdvancing}
                                onChange={checked => setStaged({ skipTrashWhenAdvancing: checked })}
                            />
                        </div>
                        <Typography.Text type="secondary" className="gallery-settings-hint">
                            Space — toggle trash (preview advances) · F — toggle favorite ·
                            Ctrl/Cmd+click — toggle · Shift+click — range · drag empty space — box select ·
                            Ctrl+A — select all · Delete — delete · Esc — clear
                        </Typography.Text>
                    </SettingsSection>
                </div>

                <SettingsSection title="Files & monitoring">
                    <div className="gallery-setting-grid">
                        <SettingToggle
                            label="Polling observer"
                            description="Fallback for problematic filesystems"
                            checked={staged.usePollingObserver}
                            onChange={checked => setStaged({ usePollingObserver: checked })}
                        />
                        <SettingToggle
                            label="Deduplicate symlinks"
                            description="Show symlinked folders once"
                            checked={staged.deduplicateSymlinks}
                            onChange={checked => setStaged({ deduplicateSymlinks: checked })}
                        />
                        <SettingToggle
                            label="Disable terminal logs"
                            description="Quiet backend output"
                            checked={staged.disableLogs}
                            onChange={checked => setStaged({ disableLogs: checked })}
                        />
                        <SettingToggle
                            label="Expand all folders"
                            description="Sidebar starts fully open"
                            checked={staged.expandAllFolders}
                            onChange={checked => setStaged({ expandAllFolders: checked })}
                        />
                    </div>
                </SettingsSection>

                <SettingsSection title="Source & thumbnails">
                    <div className="gallery-settings-fields">
                        <label className="gallery-settings-field full">
                            <span>Relative path</span>
                            <Input
                                size="small"
                                value={staged.relativePath}
                                onChange={e => setStaged({ relativePath: e.target.value })}
                            />
                        </label>
                        <label className="gallery-settings-field full">
                            <span>Button box query</span>
                            <Input
                                size="small"
                                value={staged.buttonBoxQuery}
                                onChange={e => setStaged({ buttonBoxQuery: e.target.value })}
                            />
                        </label>
                        <label className="gallery-settings-field">
                            <span>Button label</span>
                            <Input
                                size="small"
                                value={staged.buttonLabel}
                                onChange={e => setStaged({ buttonLabel: e.target.value })}
                            />
                        </label>
                        <label className="gallery-settings-field">
                            <span>Image thumb fit</span>
                            <Select
                                size="small"
                                value={staged.imageThumbFit}
                                onChange={val => setStaged({ imageThumbFit: val })}
                                options={[
                                    { value: 'width', label: 'Fit width' },
                                    { value: 'height', label: 'Fit height' },
                                ]}
                            />
                        </label>
                        <label className="gallery-settings-field">
                            <span>Video thumb fit</span>
                            <Select
                                size="small"
                                value={staged.videoThumbFit}
                                onChange={val => setStaged({ videoThumbFit: val })}
                                options={[
                                    { value: 'width', label: 'Fit width' },
                                    { value: 'height', label: 'Fit height' },
                                ]}
                            />
                        </label>
                        <label className="gallery-settings-field full">
                            <span>Scan file extensions</span>
                            <Input
                                size="small"
                                value={extInput}
                                onChange={e => setExtInput(e.target.value)}
                                placeholder="png, jpg, mp4, wav"
                            />
                        </label>
                    </div>
                </SettingsSection>
            </div>
        </Modal>
    );
};

export default GallerySettingsModal;
