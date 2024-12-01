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
        let removed = false;
        if (fs.existsSync(outputThumbnailFile) && fs.statSync(outputThumbnailFile).size === 0) {
            console.log(`Thumbnail ${outputThumbnailFile} corrupted, removing.`);
            fs.rmSync(outputThumbnailFile);
            removed = true;
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

const CAMERA_REGEX = new RegExp('(.*)\/(.*)\/RecM0(.)_(.*)_(.*)_(.*)_(.*)_(.*).mp4');
const FLAGS_CAM_V2 = {
    resolution_index: [0, 7],
    tv_system: [7, 1],
    framerate: [8, 7],
    audio_index: [15, 2],
    ai_pd: [17, 1], // person detection
    ai_fd: [18, 1], // face detection
    ai_vd: [19, 1], // vehicle detection
    ai_ad: [20, 1], // animal detection
    encoder_type_index: [21, 2],
    is_schedule_record: [23, 1],
    is_motion_record: [24, 1],
    is_rf_record: [25, 1],
    is_doorbell_record: [26, 1],
    ai_other: [27, 1],
};

export const parseVideoclipName = (videoclipPath: string) => {
    const [_, __, ___, version, date, startTime, endTime, hexValue, sizeHex] = CAMERA_REGEX.exec(videoclipPath);

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
    const flagsMapping = FLAGS_CAM_V2;
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
    if (flagValues['is_motion_record'] === 1) {
        detectionClasses.push('motion');
    }

    return {
        version,
        date,
        startTime,
        endTime,
        size,
        detectionClasses,
    };
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