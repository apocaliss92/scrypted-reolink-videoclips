import path from 'path';
import fs from 'fs';
import url from 'url';
import sdk, { MediaObject } from '@scrypted/sdk';

const { mediaManager } = sdk;

export const getFolderPaths = (deviceId: string, overridePath?: string) => {
    let basePath = overridePath;

    if (!basePath) {
        basePath = process.env.SCRYPTED_PLUGIN_VOLUME;
    }

    const thumbnailFolder = path.join(basePath, 'thumbnails', deviceId);

    if (!fs.existsSync(thumbnailFolder)) {
        fs.mkdirSync(thumbnailFolder, { recursive: true });
    }
    return { thumbnailFolder };
}

export const cleanup = (overridePath?: string) => {
    let basePath = overridePath;

    if (!basePath) {
        basePath = process.env.SCRYPTED_PLUGIN_VOLUME;
    }

    const thumbnailFolder = path.join(basePath, 'thumbnails');

    if (fs.existsSync(thumbnailFolder)) {
        fs.rmSync(thumbnailFolder, { recursive: true, force: true });
    }
}

export const getThumbnailMediaObject = async (props: {
    thumbnailFolder: string,
    filename: string,
    videoclipUrl: string,
    console: Console,
    shouldDownload: boolean
}) => {
    const { filename, thumbnailFolder, videoclipUrl, console, shouldDownload } = props;
    const outputThumbnailFile = path.join(thumbnailFolder, `${filename}.jpg`);
    let thumbnailMo: MediaObject;

    try {
        if (fs.existsSync(outputThumbnailFile) && fs.statSync(outputThumbnailFile).size === 0) {
            console.log(`Thumbnail ${outputThumbnailFile} corrupted, removing.`);
            fs.rmSync(outputThumbnailFile);
        }
        if (!fs.existsSync(outputThumbnailFile) && shouldDownload) {
            console.log(`Thumbnail not found in ${outputThumbnailFile}, generating.`);

            const mo = await mediaManager.createFFmpegMediaObject({
                inputArguments: [
                    '-ss', '00:00:05',
                    '-i', videoclipUrl,
                ],
            });
            const jpeg = await mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg');
            if (jpeg.length) {
                console.log(`Saving thumbnail in ${outputThumbnailFile}`);
                await fs.promises.writeFile(outputThumbnailFile, jpeg);
            } else {
                console.log('Not saving, image is corrupted');
            }
        }

        if (fs.existsSync(outputThumbnailFile)) {
            const fileURLToPath = url.pathToFileURL(outputThumbnailFile).toString()
            thumbnailMo = await mediaManager.createMediaObjectFromUrl(fileURLToPath);
        }

        return { thumbnailMo };
    } catch (e) {
        console.log(`Error retrieving thumbnail of videoclip ${filename} (${videoclipUrl})`, e);
        fs.existsSync(outputThumbnailFile) && fs.rmSync(outputThumbnailFile);

        return {};
    }
}

export const findStartTimeFromFileName = (fileName: string) => {
    const regex = /.*Rec(\w{3})(?:_|_DST)(\d{8})_(\d{6})_.*/gm;

    let m;
    const groups: string[] = [];

    while ((m = regex.exec(fileName)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }

        // The result can be accessed through the `m`-variable.
        m.forEach((match, groupIndex) => {
            groups.push(match);
        });
    }

    return `${groups[2]}${groups[3]}`;
}

const FLAGS_CAM_V2 = {
    resolution_index: [0, 7],
    tv_system: [7, 1],
    framerate: [8, 7],
    audio_index: [15, 2],
    ai_pd: [17, 1],
    ai_fd: [18, 1],
    ai_vd: [19, 1],
    ai_ad: [20, 1],
    encoder_type_index: [21, 2],
    is_schedule_record: [23, 1],
    is_motion_record: [24, 1],
    is_rf_record: [25, 1],
    is_doorbell_record: [26, 1],
    ai_other: [27, 1],
};
const FLAGS_HUB_V0 = {
    "resolution_index": [0, 7],
    "tv_system": [7, 1],
    "framerate": [8, 7],
    "audio_index": [15, 2],
    "ai_pd": [17, 1],
    "ai_fd": [18, 1],
    "ai_vd": [19, 1],
    "ai_ad": [20, 1],
    "encoder_type_index": [21, 2],
    "is_schedule_record": [23, 1],
    "is_motion_record": [24, 1],
    "is_rf_record": [25, 1],
    "is_doorbell_record": [26, 1],
    "is_ai_other_record": [27, 1],
    "picture_layout_index": [28, 7],
    "package_delivered": [35, 1],
    "package_takenaway": [36, 1],
}
const FLAGS_HUB_V1 = {
    ...FLAGS_HUB_V0,
    "package_event": [37, 1],
}
const FLAGS_MAPPING = {
    "cam": {
        2: FLAGS_CAM_V2,
        3: FLAGS_CAM_V2,
        4: FLAGS_CAM_V2,
        9: FLAGS_CAM_V2,
    },
    "hub": {
        0: FLAGS_HUB_V0,
        1: FLAGS_HUB_V1,
        2: {
            "resolution_index": [0, 7],
            "tv_system": [7, 1],
            "framerate": [8, 7],
            "audio_index": [15, 2],
            "ai_pd": [17, 1],
            "ai_fd": [18, 1],
            "ai_vd": [19, 1],
            "ai_ad": [20, 1],
            "ai_other": [21, 2],
            "encoder_type_index": [23, 1],
            "is_schedule_record": [24, 1],
            "is_motion_record": [25, 1],
            "is_rf_record": [26, 1],
            "is_doorbell_record": [27, 1],
            "picture_layout_index": [28, 7],
            "package_delivered": [35, 1],
            "package_takenaway": [36, 1],
            "package_event": [37, 1],
            "upload_flag": [38, 1],
        },
        // 2: {
        //     "resolution_index": [0, 7],
        //     "tv_system": [7, 1],
        //     "framerate": [8, 7],
        //     "audio_index": [15, 2],
        //     "ai_pd": [17, 1],
        //     "ai_fd": [18, 1],
        //     "ai_vd": [19, 1],
        //     "ai_ad": [20, 1],
        //     "ai_other": [21, 2],
        //     "encoder_type_index": [23, 1],
        //     "is_schedule_record": [24, 1],
        //     "is_motion_record": [25, 1],
        //     "is_rf_record": [26, 1],
        //     "is_doorbell_record": [27, 1],
        //     "picture_layout_index": [28, 7],
        //     "package_delivered": [35, 1],
        //     "package_takenaway": [36, 1],
        //     "package_event": [37, 1],
        //     "upload_flag": [38, 1],
        // },
    },
}


export const parseVideoclipName = (videoclipPath: string) => {
    try {
        const filenameWithExtension = videoclipPath.split('/').pop();
        const filename = filenameWithExtension.split('.')[0];
        const parts = filename.split('_');

        let hexValue;
        let sizeHex;
        const version = parseInt(parts[0].substring(4, 6), 16)
        let devType;
        if (parts.length === 6) {
            devType = 'cam';
            hexValue = parts[4];
            sizeHex = parts[5];
        } else if (parts.length === 9) {
            devType = 'hub';
            hexValue = parts[7];
            sizeHex = parts[8];
        }

        const hexInt = parseInt(hexValue, 16);

        // Reverse the binary representation of the integer
        const hexIntReversed = parseInt(
            hexInt
                .toString(2) // Convert to binary string
                .padStart(hexValue.length * 4, '0') // Pad with zeros
                .split('') // Split into array
                .reverse() // Reverse the array
                .join(''), // Join back into string
            2 // Convert back to integer
        );

        const flagValues = {};

        // Iterate through the flags in the mapping
        const flagsMapping = FLAGS_MAPPING[devType][version] as Record<number, [number, number]>;
        for (const [flag, [bitPosition, bitSize]] of Object.entries(flagsMapping)) {
            // Create a mask for the specified bit range
            const mask = ((1 << bitSize) - 1) << bitPosition;

            // Extract the reversed value for this flag
            const flagValueReversed = (hexIntReversed & mask) >> bitPosition;

            // Reverse the extracted value and store it in the result
            const flagValue = parseInt(
                flagValueReversed
                    .toString(2) // Convert to binary string
                    .padStart(bitSize, '0') // Pad with zeros to match the bit size
                    .split('') // Split into array
                    .reverse() // Reverse the array
                    .join(''), // Join back into string
                2 // Convert back to integer
            );

            flagValues[flag] = flagValue;
        }

        const size = Number(`0x${sizeHex}`);

        const detectionClasses: string[] = [];

        if (flagValues['ai_pd'] === 1) {
            detectionClasses.push('person');
        }
        if (flagValues['ai_vd'] === 1) {
            detectionClasses.push('vehicle');
        }
        if (flagValues['ai_fd'] === 1) {
            detectionClasses.push('face');
        }
        if (flagValues['ai_ad'] === 1) {
            detectionClasses.push('animal');
        }
        if (flagValues['is_motion_record'] === 1 || flagValues['ai_other'] === 1) {
            detectionClasses.push('motion');
        }

        return {
            // version,
            // date,
            // startTime,
            // endTime,
            size,
            detectionClasses,
        };
    } catch (e) {
        console.log('Error parsing the filename', e);
    }
}

export const splitDateRangeByDay = (start: number, end: number) => {
    const ranges: { start: number, end: number }[] = [];


    let currentStart = new Date(start);
    const endTime = new Date(end);

    while (currentStart <= endTime) {
        // Calculate the end of the current day
        const endOfDay = new Date(currentStart);
        endOfDay.setHours(23, 59, 59, 999);

        // Find the end of the current range
        const currentEnd = endTime < endOfDay ? endTime : endOfDay;

        // Add the current range to the result
        ranges.push({ start: new Date(currentStart).getTime(), end: new Date(currentEnd).getTime() });

        // Exit the loop if we've reached the end
        if (currentEnd >= endTime) break;

        // Move to the next day
        currentStart = new Date(currentEnd.getTime() + 1); // Add 1ms to move to the next interval
    }

    return ranges;
}