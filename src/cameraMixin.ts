import sdk, { VideoClips, VideoClipOptions, VideoClip, MediaObject, VideoClipThumbnailOptions, Setting, Settings } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import { ReolinkCameraClient, VideoSearchType, VideoSearchTime, VideoSearchResult } from "./client";
import ReolinkVideoclipssProvider from "./main";
import { getThumbnailMediaObject, getFolderPaths, parseVideoclipName, splitDateRangeByDay } from "./utils";
import fs from 'fs';
import path from 'path';

const { endpointManager } = sdk;

interface VideoclipFileData {
    filename: string;
    fullPath: string;
    time: VideoSearchTime;
    type: 'video' | 'image';
    size: number;
}

const videoclippathRegex = new RegExp('(.*)([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})(.*)');

export default class ReolinkVideoclipssMixin extends SettingsMixinDeviceBase<any> implements Settings, VideoClips {
    client: ReolinkCameraClient;
    killed: boolean;
    ftpScanTimeout: NodeJS.Timeout;
    ftpScanData: VideoclipFileData[] = [];

    storageSettings = new StorageSettings(this, {
        username: {
            title: 'Username',
            type: 'string',
        },
        password: {
            title: 'Password',
            type: 'password',
        },
        ftp: {
            title: 'Fetch from FTP folder',
            type: 'boolean',
            immediate: true,
            onPut: async () => this.checkFtpScan()
        },
        ftpFolder: {
            title: 'FTP folder',
            description: 'FTP folder where reolink stores the clips',
            type: 'string',
            onPut: async () => this.checkFtpScan()
        },
        filenamePrefix: {
            title: 'Filename prefix',
            description: 'This should contain any text of the clip names outside of the date numbers. I.e. Videocamera dispensa_00_20250105123640.mp4 -> Videocamera dispensa_00_',
            type: 'string',
            onPut: async () => this.checkFtpScan()
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: ReolinkVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        this.checkFtpScan().catch(this.console.log);
    }

    async release() {
        this.killed = true;
    }

    async checkFtpScan() {
        const { ftp, ftpFolder } = this.storageSettings.values;
        if (ftp && ftpFolder) {
            this.startFtpScan();
        } else {
            this.stopFtpScan();
        }
    }

    stopFtpScan() {
        if (this.ftpScanTimeout) {
            clearInterval(this.ftpScanTimeout);
        }

        this.ftpScanTimeout = undefined;
    }

    startFtpScan() {
        const { ftpFolder, filenamePrefix } = this.storageSettings.values;
        this.stopFtpScan();

        const searchFile = (dir: string, currentResult: VideoclipFileData[] = []) => {
            const result: VideoclipFileData[] = [...currentResult];
            const files = fs.readdirSync(dir) || [];

            // this.console.log('Files', files);
            for (const file of files) {
                const fullPath = path.join(dir, file);

                const fileStat = fs.statSync(fullPath);

                if (fileStat.isDirectory()) {
                    result.push(...searchFile(fullPath, result));
                } else {
                    let timestamp = file;

                    if (filenamePrefix) {
                        const splitted = file.split(filenamePrefix);
                        timestamp = splitted[1];
                    }
                    // this.console.log(`Parsing filename: ${JSON.stringify({
                    //     file,
                    //     timestamp,
                    //     videoclippathRegex
                    // })}`);

                    try {
                        const regexResult = videoclippathRegex.exec(timestamp);
                        if (regexResult) {
                            const [__, ___, year, mon, day, hour, min, sec] = regexResult;

                            result.push({
                                filename: file,
                                fullPath,
                                time: {
                                    day: Number(day),
                                    hour: Number(hour),
                                    min: Number(min),
                                    mon: Number(mon),
                                    sec: Number(sec),
                                    year: Number(year),
                                },
                                type: file.endsWith('mp4') ? 'video' : 'image',
                                size: fileStat.size
                            });
                        }
                    } catch (e) {
                        this.console.log(`Error parsing file ${file} in path ${dir}`);
                    }
                }
            }

            return result;
        }

        this.ftpScanTimeout = setInterval(async () => {
            try {
                this.ftpScanData = searchFile(ftpFolder);
            }
            catch (e) {
                this.console.log('Error in scanning the ftp folder', e);
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
            const { username, password } = this.storageSettings.values;

            this.client = new ReolinkCameraClient(
                host,
                username || usernameParent,
                password || passwordParent,
                channel,
                this.console,
                true,
            );
        }

        return this.client;
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
            const { ftp } = this.storageSettings.values;

            const videoclips: VideoClip[] = [];

            if (ftp) {
                for (const item of this.ftpScanData) {
                    const timestamp = this.processDate(item.time);

                    if (item.type === 'video' && timestamp >= options.startTime && timestamp <= options.endTime) {
                        // Check if possible to fetch it with decent performances
                        const durationInMs = 30;
                        const videoclipPath = item.fullPath;

                        const event = 'motion';
                        const { thumbnailUrl, videoclipUrl } = await this.getVideoclipWebhookUrls(videoclipPath);
                        videoclips.push({
                            id: videoclipPath,
                            startTime: timestamp,
                            // duration: Math.round(durationInMs),
                            videoId: videoclipPath,
                            thumbnailId: videoclipPath,
                            detectionClasses: [event],
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
                        });
                    }
                }
                this.console.log(`Videoclips found:`, videoclips);
            } else {
                const api = await this.getClient();

                const dateRanges = splitDateRangeByDay(options.startTime, options.endTime);

                let allSearchedElements: VideoSearchResult[] = [];

                for (const dateRange of dateRanges) {
                    const response = await api.getVideoClips({ startTime: dateRange.start, endTime: dateRange.end });
                    allSearchedElements.push(...response);
                }

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
                        });
                    } catch (e) {
                        this.console.log('error generating clip', e)
                    }
                }
            }

            return videoclips;
        } catch (e) {
            this.console.log('Error during get videoClips', e);
        }
    }

    async getVideoclipParams(videoclipId: string) {
        const { ftp } = this.storageSettings.values;
        const { thumbnailFolder } = getFolderPaths(this.id, this.plugin.storageSettings.values.downloadFolder);
        const filename = `${videoclipId.split('/').pop().split('.')[0]}`;

        let videoclipUrl: string;
        if (ftp) {
            videoclipUrl = videoclipId;
        } else {
            const api = await this.getClient();
            const { playbackPathWithHost } = await api.getVideoClipUrl(videoclipId, this.id);
            videoclipUrl = playbackPathWithHost;
        }

        return { videoclipUrl, filename, thumbnailFolder };
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
        // this.console.log('Thumbnail data: ', JSON.stringify({
        //     filename,
        //     videoclipUrl,
        //     thumbnailFolder
        // }));

        const { thumbnailMo } = await getThumbnailMediaObject({
            filename,
            thumbnailFolder,
            videoclipUrl,
            console: this.console,
        })

        return thumbnailMo;
    }

    removeVideoClips(...videoClipIds: string[]): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async getMixinSettings(): Promise<Setting[]> {
        this.storageSettings.settings.filenamePrefix.hide = !this.storageSettings.values.ftp;
        this.storageSettings.settings.ftpFolder.hide = !this.storageSettings.values.ftp;

        const settings = await this.storageSettings.getSettings();

        return settings;
    }

    async putMixinSetting(key: string, value: string) {
        this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}
