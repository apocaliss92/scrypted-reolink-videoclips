import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, WritableDeviceState } from "@scrypted/sdk";
import axios from "axios";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
const { systemManager, mediaManager, endpointManager } = sdk;

class ReolinkUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings {
    storageSettings = new StorageSettings(this, {
        pluginEnabled: {
            title: 'Download enabled',
            type: 'boolean',
            defaultValue: true,
            immediate: true,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>) {
        super(options);

        const mainPluginDevice = systemManager.getDeviceByName('Reolink utilities') as unknown as Settings;
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = await this.storageSettings.getSettings();

        // if (this.interfaces.includes(ScryptedInterface.VideoCamera)) {
        //     const detectionClasses = this.storageSettings.getItem('detectionClasses') ?? [];
        //     for (const detectionClass of detectionClasses) {
        //         const key = `${detectionClass}:scoreThreshold`;
        //         settings.push({
        //             key,
        //             title: `Score threshold for ${detectionClass}`,
        //             subgroup: 'Detection',
        //             type: 'number',
        //             value: this.storageSettings.getItem(key as any)
        //         });
        //     }
        // }

        return settings;
    }

    async putMixinSetting(key: string, value: string) {
        this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
}

export default class ReolinkUtilitiesProvider extends ScryptedDeviceBase implements MixinProvider, HttpRequestHandler {
    storageSettings = new StorageSettings(this, {
        debug: {
            title: 'Log debug messages',
            type: 'boolean',
            defaultValue: false,
            immediate: true,
        },
    });

    constructor(nativeId: string) {
        super(nativeId);
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        const decodedUrl = decodeURIComponent(request.url);
        const [_, __, ___, ____, _____, webhook, deviceName, spec] = decodedUrl.split('/');
        const device = sdk.systemManager.getDeviceByName(deviceName) as unknown as (ScryptedDeviceBase & Settings);
        const deviceSettings = await device?.getSettings();
        try {
            if (deviceSettings) {
                // if (webhook === 'snapshots') {
                // const { lastSnapshot } = await getWebookSpecs();
                // const isWebhookEnabled = deviceSettings.find(setting => setting.key === 'homeassistantMetadata:lastSnapshotWebhook')?.value as boolean;

                // if (spec === lastSnapshot) {
                //     if (isWebhookEnabled) {
                //         // response.send(`${JSON.stringify(this.storageSettings.getItem('deviceLastSnapshotMap'))}`, {
                //         //     code: 404,
                //         // });
                //         // return;
                //         const { imageUrl } = this.storageSettings.getItem('deviceLastSnapshotMap')[deviceName] ?? {};

                //         if (imageUrl) {
                //             const mo = await sdk.mediaManager.createFFmpegMediaObject({
                //                 inputArguments: [
                //                     '-i', imageUrl,
                //                 ]
                //             });
                //             const jpeg = await sdk.mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg');
                //             response.send(jpeg, {
                //                 headers: {
                //                     'Content-Type': 'image/jpeg',
                //                 }
                //             });
                //             return;
                //         } else {
                //             response.send(`Last snapshot not found for device ${deviceName} and spec ${spec}`, {
                //                 code: 404,
                //             });
                //             return;
                //         }
                //     }
                // }
                // }
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

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new ReolinkUtilitiesMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
            group: 'Reolink utilities',
            groupKey: 'reolinkUtilities',
        });
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    }
}