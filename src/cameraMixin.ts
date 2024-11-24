import sdk, { VideoClips, VideoClipOptions, VideoClip, MediaObject, VideoClipThumbnailOptions, Setting, Settings } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { keyBy } from "lodash";
import { ReolinkCameraClient, VideoSearchType, VideoSearchTime, VideoSearchResult } from "./client";
import ReolinkUtilitiesProvider from "./main";
import { getThumbnailMediaObject, getFolderPaths, parseVideoclipName, splitDateRangeByDay } from "./utils";

const { endpointManager } = sdk;

export default class ReolinkUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings, VideoClips {
    client: ReolinkCameraClient;
    killed: boolean;
    newClipsListener: NodeJS.Timeout;
    generating: boolean;

    storageSettings = new StorageSettings(this, {
        downloadVideoclips: {
            title: 'Download videoclips',
            type: 'boolean',
            immediate: true,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: ReolinkUtilitiesProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this
        this.initNewClipsListener().then().catch(this.console.log);
    }

    async initNewClipsListener() {
        this.newClipsListener = setInterval(async () => {
            if (!this.generating) {
                this.generating = true;
                const api = await this.getClient();

                const startTime = new Date().getTime() - 3600000;
                const endTime = new Date().getTime();

                const dateRanges = splitDateRangeByDay(startTime, endTime);

                let allSearchedElements: VideoSearchResult[] = [];

                for (const dateRange of dateRanges) {
                    const response = await api.getVideoClips({ startTime: dateRange.start, endTime: dateRange.end });
                    allSearchedElements.push(...response);
                }

                this.console.log(`Generating ${allSearchedElements.length} thumbnails`);

                for (const searchElement of allSearchedElements) {
                    const videoclipPath = searchElement.name;
                    await this.getVideoClipThumbnail(videoclipPath);
                }

                this.generating = false;
            }
        }, 30000);
    }

    async release() {
        this.killed = true;
    }

    async getDeviceProperties() {
        const deviceSettings = await this.mixinDevice.getSettings();

        const deviceSettingsMap = keyBy(deviceSettings, setting => setting.key);
        const username = deviceSettingsMap['username']?.value;
        const password = deviceSettingsMap['password']?.value;
        const host = deviceSettingsMap['ip']?.value;
        const channel = deviceSettingsMap['rtspChannel']?.value;

        return { username, password, host, channel }
    }

    async getClient() {
        if (!this.client) {
            const { channel, host, password, username } = await this.getDeviceProperties();
            this.client = new ReolinkCameraClient(
                host,
                username,
                password,
                channel,
                this.console,
            );
        }

        return this.client;
    }

    async updateSnapshot() {
        this.storage.setItem('snapshot:snapshotUrl', 'Test url');
    }

    async getVideoclipWebhookUrls(videoclipPath: string) {
        const cloudEndpoint = await endpointManager.getPublicCloudEndpoint();

        const videoclipUrl = `${cloudEndpoint}videoclip/${this.id}/${videoclipPath}`;
        const thumbnailUrl = `${cloudEndpoint}thumbnail/${this.id}/${videoclipPath}`;

        return { videoclipUrl, thumbnailUrl };
    }

    private processDate(date: VideoSearchTime) {
        let timeDate = new Date();

        timeDate.setFullYear(date.year);
        timeDate.setMonth(date.mon - 1);
        timeDate.setDate(date.day);
        timeDate.setHours(date.hour);
        timeDate.setMinutes(date.min);
        timeDate.setSeconds(date.sec);

        return timeDate.getTime();
    }

    async getVideoClips(options?: VideoClipOptions, streamType: VideoSearchType = 'main') {
        const { downloadVideoclips } = this.storageSettings.values;

        if (downloadVideoclips) {
            try {
                const api = await this.getClient();

                const dateRanges = splitDateRangeByDay(options.startTime, options.endTime);

                let allSearchedElements: VideoSearchResult[] = [];

                for (const dateRange of dateRanges) {
                    const response = await api.getVideoClips({ startTime: dateRange.start, endTime: dateRange.end });
                    allSearchedElements.push(...response);
                }

                const videoclips: VideoClip[] = [];
                this.console.log(`Videoclips found:`, allSearchedElements, options);

                for (const searchElement of allSearchedElements) {
                    try {
                        const startTime = this.processDate(searchElement.StartTime);
                        const entdTime = this.processDate(searchElement.EndTime);

                        const durationInMs = entdTime - startTime;
                        const videoclipPath = searchElement.name;
                        const { detectionClasses } = parseVideoclipName(videoclipPath)

                        const event = 'motion';
                        const { thumbnailUrl, videoclipUrl } = await this.getVideoclipWebhookUrls(videoclipPath);
                        videoclips.push({
                            id: videoclipPath,
                            startTime,
                            duration: Math.round(durationInMs),
                            videoId: videoclipPath,
                            thumbnailId: videoclipPath,
                            detectionClasses,
                            event,
                            description: event,
                            resources: {
                                thumbnail: {
                                    href: thumbnailUrl
                                },
                                video: {
                                    href: videoclipUrl
                                    // href: playbackPathWithHost
                                }
                            }
                        })
                    } catch (e) {
                        this.console.log('error generating clip', e)
                    }
                }

                return videoclips;
            } catch (e) {
                this.console.log('Error during get videoClips', e);
            }
        }
    }

    async getVideoclipParams(videoclipId: string) {
        const api = await this.getClient();
        const { playbackPathWithHost } = await api.getVideoClipUrl(videoclipId, this.id);

        const { videoclipsFolder, thumbnailFolder } = getFolderPaths(this.id, this.plugin.storageSettings.values.downloadFolder);
        const filename = `${videoclipId.split('/').pop().split('.')[0]}`;

        return { videoclipUrl: playbackPathWithHost, filename, videoclipsFolder, thumbnailFolder }
    }

    async getVideoClip(videoId: string): Promise<MediaObject> {
        // this.console.log('Fetching videoId ', videoId)
        const api = await this.getClient();
        const { playbackPathWithHost } = await api.getVideoClipUrl(videoId, this.id);
        const videoclipMo = await sdk.mediaManager.createMediaObject(playbackPathWithHost, 'video/mp4');

        return videoclipMo;
    }

    async getVideoClipThumbnail(thumbnailId: string, options?: VideoClipThumbnailOptions): Promise<MediaObject> {
        // this.console.log('Fetching thumbnailId ', thumbnailId);
        const { filename, videoclipUrl, thumbnailFolder } = await this.getVideoclipParams(thumbnailId);

        const { thumbnailMo } = await getThumbnailMediaObject({
            filename,
            thumbnailFolder,
            videoclipUrl,
            console: this.console,
            shouldDownload: true
        })

        return thumbnailMo;
    }

    removeVideoClips(...videoClipIds: string[]): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = await this.storageSettings.getSettings();

        return settings;
    }

    async putMixinSetting(key: string, value: string) {
        this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}