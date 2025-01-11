import { VideoClipOptions } from '@scrypted/sdk';
import { AuthFetchCredentialState, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { PassThrough, Readable } from 'stream';
import { HttpFetchOptions } from '../../scrypted/server/src/fetch/http-fetch';
import { getLoginParameters } from '../../scrypted/plugins/reolink/src/probe';

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
    credential: AuthFetchCredentialState;
    parameters: Record<string, string>;
    tokenLease: number;

    constructor(public host: string, public username: string, public password: string, public channelId: number, public console: Console, public readonly forceToken?: boolean) {
        this.credential = {
            username,
            password,
        };
    }

    private async request(options: HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...options,
            rejectUnauthorized: false,
            credential: this.credential,
            body,
        });
        return response;
    }

    private createReadable = (data: any) => {
        const pt = new PassThrough();
        pt.write(Buffer.from(JSON.stringify(data)));
        pt.end();
        return pt;
    }

    async login() {
        if (this.tokenLease > Date.now()) {
            return;
        }

        this.console.log(`token expired at ${this.tokenLease}, renewing...`);

        const { parameters, leaseTimeSeconds } = await getLoginParameters(this.host, this.username, this.password, this.forceToken);
        this.parameters = parameters
        this.tokenLease = Date.now() + 1000 * leaseTimeSeconds;
    }

    async requestWithLogin(options: HttpFetchOptions<Readable>, body?: Readable) {
        await this.login();
        const url = options.url as URL;
        const params = url.searchParams;
        for (const [k, v] of Object.entries(this.parameters)) {
            params.set(k, v);
        }
        return this.request(options, body);
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
            const response = await this.requestWithLogin({
                url,
                responseType: 'json',
                method: 'POST',
            }, this.createReadable(body));

            const error = response.body?.[0]?.error;
            if (error) {
                this.console.log('Error fetching videoclips', error, JSON.stringify({ body, url }));
                return [];
            }

            return (response.body?.[0]?.value?.SearchResult?.File ?? []) as VideoSearchResult[];
        } catch (e) {
            this.console.log('Error fetching videoclips', e);
            return [];
        }
    }

    async getVideoClipUrl(videoclipPath: string, deviceId: string) {
        const fileNameWithExtension = videoclipPath.split('/').pop();
        const fileName = fileNameWithExtension.split('.').shift();
        const downloadPath = `api.cgi?cmd=Download&source=${videoclipPath}&output=${fileNameWithExtension}&token=${this.parameters.token}`;
        const playbackPath = `cgi-bin/api.cgi?cmd=Playback&source=${videoclipPath}&output=${fileNameWithExtension}&token=${this.parameters.token}`;

        return {
            downloadPath,
            playbackPath,
            downloadPathWithHost: `http://${this.host}/${downloadPath}`,
            playbackPathWithHost: `http://${this.host}/${playbackPath}`,
            fileName,
            fileNameWithExtension,
        };
    }
}
