import sdk, { DeviceBase, HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { cleanup } from "./utils";
import ReolinkVideoclipssMixin from "./cameraMixin";
import http from 'http';
import fs from 'fs';

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
        const url = new URL(`http://localhost${request.url}`);
        const params = url.searchParams.get('params') ?? '{}';

        try {
            const [_, __, ___, ____, _____, webhook] = url.pathname.split('/');
            const { deviceId, videoclipPath, parameters } = JSON.parse(params);
            const dev = this.mixinsMap[deviceId];
            const devConsole = dev.console;
            // devConsole.log(`Request with parameters: ${JSON.stringify({
            //     webhook,
            //     deviceId,
            //     videoclipPath,
            //     parameters
            // })}`);

            try {
                if (webhook === 'videoclip') {

                    if (dev.storageSettings.values.ftp) {
                        // devConsole.log(`Videoclip requested via FTP: ${JSON.stringify({
                        //     videoclipPath,
                        //     deviceId,
                        // })}`);

                        const stat = fs.statSync(videoclipPath);
                        const fileSize = stat.size;
                        const range = request.headers.range;

                        if (range) {
                            const parts = range.replace(/bytes=/, "").split("-");
                            const start = parseInt(parts[0], 10);
                            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                            const chunksize = (end - start) + 1;
                            const file = fs.createReadStream(videoclipPath, { start, end });


                            const sendVideo = async () => {
                                return new Promise<void>((resolve, reject) => {
                                    try {
                                        response.sendStream((async function* () {
                                            for await (const chunk of file) {
                                                yield chunk;
                                            }
                                        })(), {
                                            code: 206,
                                            headers: {
                                                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                                                'Accept-Ranges': 'bytes',
                                                'Content-Length': chunksize,
                                                'Content-Type': 'video/mp4',
                                            }
                                        });

                                        resolve();
                                    } catch (err) {
                                        reject(err);
                                    }
                                });
                            };

                            try {
                                await sendVideo();
                                return;
                            } catch (e) {
                                devConsole.log('Error fetching videoclip', e);
                            }
                        } else {
                            response.sendFile(videoclipPath, {
                                code: 200,
                                headers: {
                                    'Content-Length': fileSize,
                                    'Content-Type': 'video/mp4',
                                }
                            });
                        }

                        return;
                    } else {
                        const api = await dev.getClient();

                        const { playbackPathWithHost } = await api.getVideoClipUrl(videoclipPath, deviceId);
                        // devConsole.log(`Videoclip requested via API: ${JSON.stringify({
                        //     videoclipPath,
                        //     deviceId,
                        //     playbackPathWithHost,
                        // })}`);

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
                                    devConsole.log('Error fetching videoclip', e);
                                    reject(e)
                                });
                            });
                        };

                        try {
                            await sendVideo();
                            return;
                        } catch (e) {
                            devConsole.log('Error fetching videoclip', e);
                        }
                    }
                } else
                    if (webhook === 'thumbnail') {
                        devConsole.log(`Thumbnail requested: ${JSON.stringify({
                            videoclipPath,
                            deviceId,
                        })}`);
                        const thumbnailMo = await dev.getVideoClipThumbnail(videoclipPath);
                        const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(thumbnailMo, 'image/jpeg');
                        response.send(jpeg, {
                            headers: {
                                'Content-Type': 'image/jpeg',
                            }
                        });
                        return;
                    }
            } catch (e) {
                devConsole.log(`Error in webhook`, e);
                response.send(`${JSON.stringify(e)}, ${e.message}`, {
                    code: 400,
                });

                return;
            }

            response.send(`Webhook not found: ${url.pathname}`, {
                code: 404,
            });

            return;
        } catch (e) {
            this.console.log('Error in data parsing for webhook', e);
            response.send(`Error in data parsing for webhook: ${JSON.stringify({
                params,
                url: request.url
            })}`, {
                code: 500,
            });
        }
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