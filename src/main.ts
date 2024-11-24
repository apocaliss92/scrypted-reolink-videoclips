import sdk, { DeviceBase, HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { cleanup } from "./utils";
import ReolinkUtilitiesMixin from "./cameraMixin";

export default class ReolinkUtilitiesProvider extends ScryptedDeviceBase implements MixinProvider, HttpRequestHandler {
    storageSettings = new StorageSettings(this, {
        debug: {
            title: 'Log debug messages',
            type: 'boolean',
            defaultValue: false,
            immediate: true,
        },
        downloadFolder: {
            title: 'Directory where to cache thumbnails and videoclips',
            description: 'Default to the plugin folder',
            type: 'string',
        },
        basicAuthToken: {
            title: 'Basic authnetication token',
            type: 'string',
        },
        clearDownloadedData: {
            title: 'clear thumbnails and videoclips',
            type: 'button',
            onPut: async () => await cleanup(this.storageSettings.values.downloadFolder)
        },
    });
    public mixinsMap: Record<string, ReolinkUtilitiesMixin> = {};

    constructor(nativeId: string) {
        super(nativeId);
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        const decodedUrl = decodeURIComponent(request.url);
        const [_, __, ___, ____, _____, webhook, ...rest] = decodedUrl.split('/');
        const [deviceId, ...videoclipPath] = rest;
        const videoclipId = videoclipPath.join('/');
        const dev = this.mixinsMap[deviceId];
        try {
            if (webhook === 'videoclip') {
                const api = await dev.getClient();
                const { playbackPathWithHost } = await api.getVideoClipUrl(videoclipId, deviceId);
                const basicAuthToken = this.storageSettings.values.basicAuthToken;
                response.send('', {
                    code: 302,
                    headers: {
                        'Set-Cookie': `token=${basicAuthToken}`,
                        Location: playbackPathWithHost,
                        Authentication: `Basic ${basicAuthToken}`
                    }
                });
                return;
            } else
                if (webhook === 'thumbnail') {
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
            response.send(`${JSON.stringify(e)}, ${e.message}`, {
                code: 400,
            });

            return;
        }
        response.send(`Webhook not found`, {
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
            ] :
            undefined;
    }

    async getMixin(mixinDevice: DeviceBase, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new ReolinkUtilitiesMixin(
            {
                mixinDevice,
                mixinDeviceInterfaces,
                mixinDeviceState,
                mixinProviderNativeId: this.nativeId,
                group: 'Reolink utilities',
                groupKey: 'reolinkUtilities',
            },
            this);
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}