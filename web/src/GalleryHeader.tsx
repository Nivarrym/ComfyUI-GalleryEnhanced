import { useEffect, useRef, useState } from 'react';
import { Flex, AutoComplete, Button, Segmented, Tag, Tooltip, Typography } from 'antd';
import { BugOutlined, CloseSquareFilled, DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons';
import { useGalleryContext } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';

const GalleryHeader = () => {
    const {
        showSettings, setShowSettings,
        setSearchFileName,
        sortMethod, setSortMethod,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
        setOpen,
        selectedImages,
        setShowPerf,
        siderCollapsed, setSiderCollapsed
    } = useGalleryContext();

    const [search, setSearch] = useState("");
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [countdown] = useCountDown({
        targetDate,
        onEnd: () => {
            setOpen(false);
            setShowClose(false);
            setTargetDate(undefined);
        },
    });
    const dragCounter = useRef(0);

    // Show close button only when dragging
    useEffect(() => {
        const onDragStart = () => setShowClose(true);
        const onDragEnd = () => {
            setShowClose(false);
            setTargetDate(undefined);
        };
        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, []);

    // Debounce the search input to prevent lag
    const debouncedSearch = useDebounce(search, { wait: 100 });

    useEffect(() => {
        setSearchFileName(debouncedSearch);

        if (!debouncedSearch || debouncedSearch.length == 0) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions]);

    return (
        <Flex
            justify={"space-between"}
            align={"center"}
            gap={16}
            style={{ width: '100%' }}
        >
            <div
                style={{
                    display: "flex",
                    alignContent: "center",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "8px",
                }}
            >
                <Button
                    size="middle"
                    onClick={() => setSiderCollapsed((prev: boolean) => !prev)}
                    aria-label="Toggle sidebar"
                >
                    {siderCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
                </Button>
                <Button
                    size={"middle"}
                    onClick={() => setShowSettings(true)}
                >
                    Settings
                </Button>
                <Tooltip title="Performance report">
                    <Button
                        size={"middle"}
                        icon={<BugOutlined />}
                        onClick={() => setShowPerf(true)}
                        aria-label="Performance report"
                    />
                </Tooltip>
            </div>
            {selectedImages.length > 0 && (
                <Tag color="blue" style={{ marginInlineEnd: 0, whiteSpace: 'nowrap' }}>
                    {selectedImages.length} selected
                </Tag>
            )}
            {showClose && (
                <div
                    style={{
                        display: 'inline-block'
                    }}
                    onDragEnter={e => {
                        e.preventDefault();
                        dragCounter.current++;
                        if (!targetDate) {
                            setTargetDate(Date.now() + 3000);
                        }
                    }}
                    onDragLeave={e => {
                        e.preventDefault();
                        dragCounter.current--;
                        if (dragCounter.current === 0 && targetDate) {
                            setTargetDate(undefined);
                        }
                    }}
                >
                    <Button
                        type="default"
                        style={{
                            marginLeft: "8px",
                            display: "flex",
                            alignItems: "center",
                            position: "relative",
                            cursor: "pointer",
                            justifyContent: "center",
                            alignContent: "center",
                            flexWrap: "wrap",
                            width: 150
                        }}
                        tabIndex={-1} // Prevent focus flicker
                    >
                        {targetDate
                            ? (
                                <Typography
                                    style={{
                                        color: '#ff4d4f',
                                        fontWeight: 500
                                    }}
                                >
                                    {`   Close in ${Math.ceil(countdown / 1000)}s   `}
                                </Typography>
                            ) : (
                                <Typography
                                    style={{
                                        color: '#888',
                                        fontWeight: 400
                                    }}
                                >
                                    Hover to close 3s
                                </Typography>
                            )
                        }
                    </Button>
                </div>
            )}
            <AutoComplete
                options={
                    autoCompleteOptions && autoCompleteOptions.length > 0
                        ? autoCompleteOptions
                        : imagesAutoCompleteNames
                }
                style={{
                    width: '50%'
                }}
                onSearch={text => setSearch(text)}
                value={search}
                onChange={val => setSearch(val)}
                placeholder="Search for file name"
                allowClear={{
                    clearIcon: <CloseSquareFilled />
                }}
            />
            <Segmented<string>
                style={{
                    marginRight: 8
                }}
                options={['Newest', 'Oldest', 'Name ↑', 'Name ↓']}
                value={sortMethod}
                onChange={value => setSortMethod(value as any)}
            />
        </Flex>
    );
};

export default GalleryHeader;
