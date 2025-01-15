import sdk, { VideoClips, VideoClipOptions, VideoClip, MediaObject, VideoClipThumbnailOptions, Setting, Settings, RequestPictureOptions, Camera, PictureOptions, ScryptedInterface } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import { ReolinkCameraClient, VideoSearchType, VideoSearchTime, VideoSearchResult } from "./client";
import ReolinkVideoclipssProvider from "./main";
import { getThumbnailMediaObject, getFolderPaths, parseVideoclipName, splitDateRangeByDay } from "./utils";

const { endpointManager } = sdk;

export default class ReolinkVideoclipssMixin extends SettingsMixinDeviceBase<any> implements Settings, Camera, VideoClips {
    client: ReolinkCameraClient;
    killed: boolean;
    batteryTimeout: NodeJS.Timeout;
    lastSnapshot?: Promise<MediaObject>;

    storageSettings = new StorageSettings(this, {
        username: {
            title: 'Username',
            type: 'string',
        },
        password: {
            title: 'Password',
            type: 'password',
        },
        loginParams: {
            hide: true,
            type: 'string',
            json: true,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: ReolinkVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        this.checkBatteryStuff().catch(this.console.log);
    }

    async release() {
        this.stopBatteryCheckInterval();
        this.killed = true;
    }

    async checkBatteryStuff() {
        if (this.isBattery()) {
            this.startBatteryCheckInterval();
        } else {
            this.stopBatteryCheckInterval();
        }
    }

    stopBatteryCheckInterval() {
        if (this.batteryTimeout) {
            clearInterval(this.batteryTimeout);
        }

        this.batteryTimeout = undefined;
    }

    startBatteryCheckInterval() {
        this.stopBatteryCheckInterval();

        this.batteryTimeout = setInterval(async () => {
            const client = await this.getClient();

            try {
                const { sleep } = await client.getBatteryInfo();
                if (sleep === false) {
                    this.console.log('Camera is not sleeping, snapping');
                    this.lastSnapshot = this.createMediaObject(await client.jpegSnapshot(), 'image/jpeg');
                }
            }
            catch (e) {
                this.console.log('Error in getting battery info', e);
            }
        }, 1000 * 10);
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
            const { channel, host, username: usernameParent, password: passwordParent } = await this.getDeviceProperties();
            const { username, password, loginParams } = this.storageSettings.values;

            this.client = new ReolinkCameraClient(
                host,
                username || usernameParent,
                password || passwordParent,
                channel,
                this.console,
                (loginParams) => this.storageSettings.values.loginParams = loginParams,
                loginParams,
                true,
            );
        }

        return this.client;
    }

    async updateSnapshot() {
        this.storage.setItem('snapshot:snapshotUrl', 'Test url');
    }

    async getVideoclipWebhookUrls(videoclipPath: string) {
        const cloudEndpoint = await endpointManager.getCloudEndpoint(undefined, { public: true });
        const [endpoint, parameters] = cloudEndpoint.split('?') ?? '';
        const params = {
            deviceId: this.id,
            videoclipPath,
        }

        const videoclipUrl = `${endpoint}videoclip?params=${JSON.stringify(params)}&${parameters}`;
        const thumbnailUrl = `${endpoint}thumbnail?params=${JSON.stringify(params)}&${parameters}`;

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
        try {
            const api = await this.getClient();

            const dateRanges = splitDateRangeByDay(options.startTime, options.endTime);

            let allSearchedElements: VideoSearchResult[] = [];

            for (const dateRange of dateRanges) {
                const response = await api.getVideoClips({ startTime: dateRange.start, endTime: dateRange.end });
                allSearchedElements.push(...response);
            }

            const videoclips: VideoClip[] = [];
            this.console.log(`Videoclips found:`, allSearchedElements, dateRanges, api.parameters.token);

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

    async getVideoclipParams(videoclipId: string) {
        const api = await this.getClient();
        const { playbackPathWithHost } = await api.getVideoClipUrl(videoclipId, this.id);

        const { thumbnailFolder } = getFolderPaths(this.id, this.plugin.storageSettings.values.downloadFolder);
        const filename = `${videoclipId.split('/').pop().split('.')[0]}`;

        return { videoclipUrl: playbackPathWithHost, filename, thumbnailFolder }
    }

    async getVideoClip(videoId: string): Promise<MediaObject> {
        this.console.log('Fetching videoId ', videoId);
        const { videoclipUrl } = await this.getVideoclipWebhookUrls(videoId);
        const videoclipMo = await sdk.mediaManager.createMediaObject(videoclipUrl, 'video/mp4');

        return videoclipMo;
    }

    async getVideoClipThumbnail(thumbnailId: string, options?: VideoClipThumbnailOptions): Promise<MediaObject> {
        this.console.log('Fetching thumbnailId ', thumbnailId);
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
        const settings = await this.storageSettings.getSettings();

        return settings;
    }

    async putMixinSetting(key: string, value: string) {
        this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }

    isBattery() {
        return this.interfaces.includes(ScryptedInterface.Battery);
    }

    async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
        const client = await this.getClient();
        if (this.isBattery()) {
            return this.lastSnapshot;
        } else {
            return this.createMediaObject(await client.jpegSnapshot(options?.timeout), 'image/jpeg');
        }
    }

    // async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
    //     const now = new Date().getTime();
    //     const { snapshotInSeconds } = this.storageSettings.values;
    //     const client = await this.getClient();
    //     let shouldGenerateNewImage = false;

    //     if (!snapshotInSeconds) {
    //         shouldGenerateNewImage = true;
    //     } else if (!this.lastSnapshot) {
    //         shouldGenerateNewImage = true;
    //     } else if (this.lastSnapshot && (now - this.lastSnapshotRequested) >= (1000 * snapshotInSeconds)) {
    //         shouldGenerateNewImage = true;
    //     }

    //     if (shouldGenerateNewImage) {
    //         this.lastSnapshotRequested = now;
    //         this.lastSnapshot = this.createMediaObject(await client.jpegSnapshot(options?.timeout), 'image/jpeg');
    //     }

    //     return this.lastSnapshot;
    // }

    async takePicture(options?: RequestPictureOptions) {
        return this.takeSmartCameraPicture(options);
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }
}