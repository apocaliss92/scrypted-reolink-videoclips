import { VideoClipOptions } from '@scrypted/sdk';
import axios, { AxiosRequestConfig } from 'axios';

export interface VideoSearchTime {
    day: number;
    hour: number;
    min: number;
    mon: number;
    sec: number;
    year: number;
}

export interface VideoSearchResult {
    EndTime: VideoSearchTime;
    StartTime: VideoSearchTime;
    frameRate: number;
    height: number;
    name: string;
    size: number;
    type: number;
    width: number;
}

export type VideoSearchType = 'sub' | 'main';

export class ReolinkCameraClient {
    token: string;
    tokenLease: number;

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console, public readonly forceToken?: boolean) { }

    async getToken(host: string, username: string, password: string) {
        try {
            const url = new URL(`http://${host}/api.cgi`);
            const params = url.searchParams;
            params.set('cmd', 'Login');

            const response = await axios.post(url.href, [
                {
                    cmd: 'Login',
                    action: 0,
                    param: {
                        User: {
                            userName: username,
                            password: password
                        }
                    }
                },
            ], { responseType: 'json' });

            const token = response.data?.[0]?.value?.Token?.name || response.data?.value?.Token?.name;

            if (!token)
                throw new Error('unable to login');

            const { data } = response;
            const leaseTimeSeconds: number = data?.[0]?.value?.Token.leaseTime || data?.value?.Token.leaseTime;

            return {
                token,
                leaseTimeSeconds,
            }
        }
        catch (e) {
            this.console.log('Error during login', e);
        }
    }


    private async request(options: AxiosRequestConfig, withToken?: boolean) {
        await this.login();
        const url = new URL(options.url);
        const params = url.searchParams;
        if (withToken) {
            params.set('token', this.token)
        } else {
            params.set('username', this.username)
            params.set('password', this.password)
        }

        options.url = url.href;
        const response = axios.request(
            {
                method: 'GET',
                responseType: 'json',
                ...options
            }
        )

        return response;
    }

    async login() {
        if (this.tokenLease && this.token && this.tokenLease > Date.now()) {
            return;
        }

        this.console.log(`token ${this.token} expired at ${this.tokenLease}, renewing...`);

        const { token, leaseTimeSeconds } = await this.getToken(this.host, this.username, this.password);
        this.token = token
        this.tokenLease = Date.now() + 1000 * leaseTimeSeconds;
    }

    async getVideoClips(options?: VideoClipOptions, streamType: VideoSearchType = 'main') {
        const url = new URL(`http://${this.host}/api.cgi`);

        const startTime = new Date(options.startTime);
        let endTime = options.endTime ? new Date(options.endTime) : undefined;

        // If the endTime is not the same day as startTime, 
        // or no endDate is provided, set to the end of the startTime
        // Reolink only supports 1 day recordings fetching
        if (!endTime || endTime.getDate() > startTime.getDate()) {
            endTime = new Date(startTime);
            endTime.setHours(23);
            endTime.setMinutes(59);
            endTime.setSeconds(59);
        }

        const body = [
            {
                cmd: "Search",
                action: 1,
                param: {
                    Search: {
                        channel: this.channelId,
                        streamType,
                        onlyStatus: 0,
                        StartTime: {
                            year: startTime.getFullYear(),
                            mon: startTime.getMonth() + 1,
                            day: startTime.getDate(),
                            hour: startTime.getHours(),
                            min: startTime.getMinutes(),
                            sec: startTime.getSeconds()
                        },
                        EndTime: {
                            year: endTime.getFullYear(),
                            mon: endTime.getMonth() + 1,
                            day: endTime.getDate(),
                            hour: endTime.getHours(),
                            min: endTime.getMinutes(),
                            sec: endTime.getSeconds()
                        }
                    }
                }
            }
        ];

        try {
            const response = await this.request({
                url: url.href,
                method: 'POST',
                data: body
            }, true);

            return (response.data?.[0]?.value?.SearchResult?.File ?? []) as VideoSearchResult[];
        } catch (e) {
            this.console.log('Error fetching videoclips', e);
            return [];
        }
    }

    async getVideoClipUrl(videoclipPath: string, deviceId: string) {
        await this.login();

        const fileNameWithExtension = videoclipPath.split('/').pop();
        const fileName = fileNameWithExtension.split('.').shift();
        const downloadPath = `api.cgi?cmd=Download&source=${videoclipPath}&output=${fileNameWithExtension}&token=${this.token}`;
        const playbackPath = `cgi-bin/api.cgi?cmd=Playback&source=${videoclipPath}&output=${fileNameWithExtension}&token=${this.token}`;

        // const auth = 'Basic c2NyeXB0ZWQ6QmZZYkhZN2ViVG1xRmFNbVdrTG16SkRpalZuMU5PQzFUMDBNb0lJOUtDY2ZJVktwS3lCZnhwTXV1blFR';
        return {
            downloadPath,
            playbackPath,
            downloadPathWithHost: `https://recordings.gianlucaruocco.top/${deviceId}/${downloadPath}`,
            playbackPathWithHost: `https://recordings.gianlucaruocco.top/${deviceId}/${playbackPath}`,
            fileName,
            fileNameWithExtension,
        };
    }

    async getBatteryInfo() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [
            {
                cmd: "GetBatteryInfo",
                action: 0,
                param: { channel: this.channelId }
            },
            {
                cmd: "GetChannelstatus",
            }
        ];

        const response = await this.request({
            url: url.href,
            method: 'POST',
            data: body
        }, true);

        const error = response.data?.find(elem => elem.error)?.error;
        if (error) {
            this.console.error('error during call to getBatteryInfo', error);
        }

        const batteryInfoEntry = response.data.find(entry => entry.cmd === 'GetBatteryInfo')?.value?.Battery;
        const channelStatusEntry = response.data.find(entry => entry.cmd === 'GetChannelstatus')?.value?.status
            ?.find(chStatus => chStatus.channel === this.channelId);

        const isOnline = channelStatusEntry?.online === 1;
        const isSleeping = isOnline ? channelStatusEntry?.sleep === 1 : true;

        return {
            batteryPercent: batteryInfoEntry?.batteryPercent,
            sleep: isSleeping,
        }
    }

    async getWhiteLed() {
        const url = new URL(`http://${this.host}/api.cgi`);

        const body = [
            {
                cmd: "GetWhiteLed",
                action: 0,
                param: { channel: this.channelId }
            }
        ];

        const response = await this.request({
            url: url.href,
            method: 'POST',
            data: body
        }, true);

        return response.data;
    }

    async jpegSnapshot(timeout = 10000) {
        const url = new URL(`http://${this.host}/cgi-bin/api.cgi`);
        const params = url.searchParams;
        params.set('cmd', 'Snap');
        params.set('channel', this.channelId.toString());
        params.set('rs', Date.now().toString());

        const response = await this.request({
            url: url.href,
            method: 'GET',
            timeout,
            responseType: 'arraybuffer'
        }, true);

        return response.data;
    }
}
