import sdk, { DeviceBase, HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { cleanup } from "./utils";
import ReolinkVideoclipssMixin from "./cameraMixin";
import http from 'http';

export default class ReolinkVideoclipssProvider extends ScryptedDeviceBase implements MixinProvider, HttpRequestHandler {
    storageSettings = new StorageSettings(this, {
        downloadFolder: {
            title: 'Directory where to cache thumbnails and videoclips',
            description: 'Default to the plugin folder',
            type: 'string',
        },
        clearDownloadedData: {
            title: 'clear stored data',
            type: 'button',
            onPut: async () => await cleanup(this.storageSettings.values.downloadFolder)
        },
    });
    public mixinsMap: Record<string, ReolinkVideoclipssMixin> = {};

    constructor(nativeId: string) {
        super(nativeId);
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        const decodedUrlWithParams = decodeURIComponent(request.url);
        const [decodedUrl] = decodedUrlWithParams.split('?');
        const [_, __, ___, ____, _____, webhook, ...rest] = decodedUrl.split('/');
        const [deviceId, ...videoclipPath] = rest;
        const videoclipId = videoclipPath.join('/');
        const dev = this.mixinsMap[deviceId];

        try {
            if (webhook === 'videoclip') {
                const api = await dev.getClient();

                const { playbackPathWithHost } = await api.getVideoClipUrl(videoclipId, deviceId);
                this.console.log(`Videoclip requested: ${JSON.stringify({
                    videoclipId,
                    deviceId,
                    playbackPathWithHost,
                })}`);

                const sendVideo = async () => {
                    return new Promise<void>((resolve, reject) => {
                        http.get(playbackPathWithHost, { headers: request.headers }, (httpResponse) => {
                            if (httpResponse.statusCode[0] === 400) {
                                reject(new Error(`Error loading the video: ${httpResponse.statusCode} - ${httpResponse.statusMessage}. Headers: ${JSON.stringify(request.headers)}`));
                                return;
                            }

                            try {
                                response.sendStream((async function* () {
                                    for await (const chunk of httpResponse) {
                                        yield chunk;
                                    }
                                })(), {
                                    headers: httpResponse.headers
                                });

                                resolve();
                            } catch (err) {
                                reject(err);
                            }
                        }).on('error', (e) => {
                            this.console.log('Error fetching videoclip', e);
                            reject(e)
                        });
                    });
                }

                try {
                    await sendVideo();
                    return;
                } catch (e) {
                    this.console.log('Error fetching videoclip', e);
                }
            } else
                if (webhook === 'thumbnail') {
                    this.console.log(`Thumbnail requested: ${JSON.stringify({
                        videoclipId,
                        deviceId,
                    })}`);
                    const thumbnailMo = await dev.getVideoClipThumbnail(videoclipId);
                    const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(thumbnailMo, 'image/jpeg');
                    response.send(jpeg, {
                        headers: {
                            'Content-Type': 'image/jpeg',
                        }
                    });
                    return;
                }
        } catch (e) {
            this.console.log(`Error in webhook`, e);
            response.send(`${JSON.stringify(e)}, ${e.message}`, {
                code: 400,
            });

            return;
        }
        response.send(`Webhook not found: ${decodedUrl}`, {
            code: 404,
        });

        return;
    }

    async getSettings() {
        const settings: Setting[] = await this.storageSettings.getSettings();

        return settings;
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }


    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.VideoCamera,
        ].some(int => interfaces.includes(int)) ?
            [
                ScryptedInterface.Settings,
                ScryptedInterface.VideoClips,
                ScryptedInterface.Camera,
            ] :
            undefined;
    }

    async getMixin(mixinDevice: DeviceBase, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new ReolinkVideoclipssMixin(
            {
                mixinDevice,
                mixinDeviceInterfaces,
                mixinDeviceState,
                mixinProviderNativeId: this.nativeId,
                group: 'Reolink videoclips',
                groupKey: 'reolinkVideoclips',
            },
            this);
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}