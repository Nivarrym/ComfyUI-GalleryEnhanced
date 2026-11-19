import Modal from 'antd/es/modal/Modal';
import { Button, Divider, Flex, Input, Select, Switch, Typography } from 'antd';
import { useGalleryContext, type SettingsState } from './GalleryContext';
import { useSetState } from 'ahooks';
import { useEffect, useState } from 'react';
import { BASE_Z_INDEX } from './ComfyAppApi';
import { GithubOutlined, LineChartOutlined } from '@ant-design/icons';
import { galleryThemeClass } from './theme';

const GallerySettingsModal = () => {
    const { showSettings, setShowSettings, settings, setSettings, setShowPerf } = useGalleryContext();
    // Staged (unsaved) settings
    const [staged, setStaged] = useSetState<SettingsState>(settings);
    const [extInput, setExtInput] = useState("");

    // When modal opens, reset staged to current settings
    useEffect(() => {
        if (showSettings) {
            setStaged(settings);
            setExtInput((settings && (settings as any).scanExtensions) ? (settings as any).scanExtensions.join(', ') : "");
        }
    }, [showSettings, settings, setStaged]);

    // Save staged settings to context and close
    const handleSave = () => {
        const exts = extInput.split(',').map(s => s.trim().replace(/^\./, '')).filter(s => s);
        const newSettings = { ...staged, scanExtensions: exts } as SettingsState;
        setSettings(newSettings);
        setShowSettings(false);
    };
    // Cancel: just close modal (staged will reset on next open)
    const handleCancel = () => {
        setShowSettings(false);
    };

    return (
        <Modal
            zIndex={BASE_Z_INDEX + 1}
            rootClassName={`gallery-settings-modal-root ${galleryThemeClass(settings.darkMode)}`}
            title={"Settings"}
            open={showSettings}
            centered
            afterOpenChange={setShowSettings}
            onOk={handleSave}
            onCancel={handleCancel}
            footer={(
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
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
            <Flex
                vertical
                gap={16}
            >
                <div>
                    <Typography.Title level={5}>Appearance</Typography.Title>
                    <Flex vertical gap={10}>
                        <Switch
                            checkedChildren={"Dark Mode"}
                            unCheckedChildren={"Light Mode"}
                            checked={staged.darkMode}
                            onChange={checked => setStaged({ darkMode: checked })}
                        />
                        <Switch
                            checkedChildren={"Play Videos on Hover"}
                            unCheckedChildren={"Do Not Play Videos"}
                            checked={staged.autoPlayVideos}
                            onChange={checked => setStaged({ autoPlayVideos: checked })}
                        />
                        <Switch
                            checkedChildren={"Show Date Divider"}
                            unCheckedChildren={"Don't Show Date Divider"}
                            checked={staged.showDateDivider}
                            onChange={checked => setStaged({ showDateDivider: checked })}
                        />
                        <Switch
                            checkedChildren={"Floating Button"}
                            unCheckedChildren={"Normal Button"}
                            checked={staged.floatingButton}
                            onChange={checked => setStaged({ floatingButton: checked })}
                        />
                        <Switch
                            checkedChildren={"Hide Open Button"}
                            unCheckedChildren={"Show Open Button"}
                            checked={staged.hideOpenButton}
                            onChange={checked => setStaged({ hideOpenButton: checked })}
                        />
                    </Flex>
                </div>

                <Divider style={{ margin: '0' }} />

                <div>
                    <Typography.Title level={5}>Performance</Typography.Title>
                    <Flex vertical gap={10}>
                        <Switch
                            checkedChildren={"Debug Performance"}
                            unCheckedChildren={"Debug Performance Off"}
                            checked={staged.debugPerf}
                            onChange={checked => setStaged({ debugPerf: checked })}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Logs bootstrap, listing, first paint, thumbnail paging and server scan timings.
                        </Typography.Text>
                        <Button
                            icon={<LineChartOutlined />}
                            onClick={() => {
                                setShowSettings(false);
                                setShowPerf(true);
                            }}
                        >
                            Open performance report
                        </Button>
                    </Flex>
                </div>

                <Divider style={{ margin: '0' }} />

                <div>
                    <Typography.Title level={5}>Files</Typography.Title>
                    <Flex vertical gap={10}>
                        <Switch
                            checkedChildren={"Use Polling Observer"}
                            unCheckedChildren={"Use Native Observer"}
                            checked={staged.usePollingObserver}
                            onChange={checked => setStaged({ usePollingObserver: checked })}
                        />
                        <Switch
                            checkedChildren={"Deduplicate Symlinks"}
                            unCheckedChildren={"Show Symlinks Everywhere"}
                            checked={staged.deduplicateSymlinks}
                            onChange={checked => setStaged({ deduplicateSymlinks: checked })}
                        />
                        <Switch
                            checkedChildren={"Disable Terminal Logs"}
                            unCheckedChildren={"Enable Terminal Logs"}
                            checked={staged.disableLogs}
                            onChange={checked => setStaged({ disableLogs: checked })}
                        />
                        <Switch
                            checkedChildren={"Expand All Folders"}
                            unCheckedChildren={"Collapse All Folders"}
                            checked={staged.expandAllFolders}
                            onChange={checked => setStaged({ expandAllFolders: checked })}
                        />
                    </Flex>
                </div>

                <Divider style={{ margin: '0' }} />

                <div>
                    <Typography.Title level={5}>Navigation & Shortcuts</Typography.Title>
                    <Flex vertical gap={10}>
                        <Switch
                            checkedChildren={"Enable Ctrl+G Shortcut"}
                            unCheckedChildren={"Disable Ctrl+G Shortcut"}
                            checked={staged.galleryShortcut}
                            onChange={checked => setStaged({ galleryShortcut: checked })}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Gallery shortcuts: Ctrl/Cmd+click — toggle, Shift+click — range, drag empty space — box select,
                            Ctrl+A — select all, Delete — delete selected, Esc — clear selection.
                        </Typography.Text>
                    </Flex>
                </div>

                <Divider style={{ margin: '0' }} />

                <div>
                    <Typography.Title level={5}>Relative Path:</Typography.Title>
                    <Input
                        value={staged.relativePath}
                        onChange={e => setStaged({ relativePath: e.target.value })}
                    />
                </div>
                <div>
                    <Typography.Title level={5}>Button Box Query:</Typography.Title>
                    <Input
                        value={staged.buttonBoxQuery}
                        onChange={e => setStaged({ buttonBoxQuery: e.target.value })}
                    />
                </div>
                <div>
                    <Typography.Title level={5}>Button Label:</Typography.Title>
                    <Input
                        value={staged.buttonLabel}
                        onChange={e => setStaged({ buttonLabel: e.target.value })}
                    />
                </div>
                <div>
                    <Typography.Title level={5}>Image Thumb Fit:</Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Constrain image thumbnails in the grid by width or height</Typography.Text>
                    <Select
                        value={staged.imageThumbFit}
                        onChange={val => setStaged({ imageThumbFit: val })}
                        style={{ width: '100%' }}
                        options={[
                            { value: 'width', label: 'Fit Width' },
                            { value: 'height', label: 'Fit Height' },
                        ]}
                    />
                </div>
                <div>
                    <Typography.Title level={5}>Video Thumb Fit:</Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Constrain video thumbnails in the grid by width or height</Typography.Text>
                    <Select
                        value={staged.videoThumbFit}
                        onChange={val => setStaged({ videoThumbFit: val })}
                        style={{ width: '100%' }}
                        options={[
                            { value: 'width', label: 'Fit Width' },
                            { value: 'height', label: 'Fit Height' },
                        ]}
                    />
                </div>
                <div>
                    <Typography.Title level={5}>Scan File Extensions:</Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Comma separated (e.g. png, jpg, mp4, wav)</Typography.Text>
                    <Input value={extInput} onChange={e => setExtInput(e.target.value)} />
                </div>
            </Flex>
        </Modal>
    );
};

export default GallerySettingsModal;
