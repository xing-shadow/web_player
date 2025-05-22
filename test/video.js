let webglPlayer, canvas;
let LOG_LEVEL_JS = 0;
let LOG_LEVEL_WASM = 1;
let LOG_LEVEL_FFMPEG = 2;

// This function takes in three parameters: frameType, data, and timestamp. It then uses a switch statement to determine what to do with the data based on the frameType.
function DecodeData(frameType, data, pts) {
    // If the frameType is 0x01 or 0x02, log the timestamp and data to the console.
    switch (frameType) {
        case 0x01:
        case 0x02:
            console.log("解码数据帧")
            // Get the length of the data and allocate memory for it.
            let size = data.length
            let cacheBuffer = Module._malloc(size);
            // Set the data into the allocated memory.
            HEAPU8.set(data, cacheBuffer);

            // Call the decodeData function with the allocated memory, size, and timestamp.
            Module._decodeData(cacheBuffer, size, pts)
            // If the cacheBuffer is not null, free the memory.
            if (cacheBuffer != null) {
                Module._free(cacheBuffer);
                cacheBuffer = null;
            }
            break
    }
}

function DecodeH264Data(data, pts) {
    // If the frameType is 0x01 or 0x02, log the timestamp and data to the console.
    console.log("解码h264数据")
    // Get the length of the data and allocate memory for it.
    let size = data.length
    let cacheBuffer = Module._malloc(size);
    // Set the data into the allocated memory.
    HEAPU8.set(data, cacheBuffer);

    // Call the decodeData function with the allocated memory, size, and timestamp.
    Module._decodeH264Data(cacheBuffer, size, pts)
    // If the cacheBuffer is not null, free the memory.
    if (cacheBuffer != null) {
        Module._free(cacheBuffer);
        cacheBuffer = null;
    }
}

function DecodeH265Data(data, pts) {
    // If the frameType is 0x01 or 0x02, log the timestamp and data to the console.
    console.log("解码h265数据")
    // Get the length of the data and allocate memory for it.
    let size = data.length
    let cacheBuffer = Module._malloc(size);
    // Set the data into the allocated memory.
    HEAPU8.set(data, cacheBuffer);

    // Call the decodeData function with the allocated memory, size, and timestamp.
    Module._decodeH265Data(cacheBuffer, size, pts)
    // If the cacheBuffer is not null, free the memory.
    if (cacheBuffer != null) {
        Module._free(cacheBuffer);
        cacheBuffer = null;
    }
}

function DecodePcmaData(data, pts) {
    // If the frameType is 0x01 or 0x02, log the timestamp and data to the console.
    console.log("解码pcma数据")
    // Get the length of the data and allocate memory for it.
    let size = data.length
    let cacheBuffer = Module._malloc(size);
    // Set the data into the allocated memory.
    HEAPU8.set(data, cacheBuffer);

    // Call the decodeData function with the allocated memory, size, and timestamp.
    Module._decodePcmaData(cacheBuffer, size, pts)
    // If the cacheBuffer is not null, free the memory.
    if (cacheBuffer != null) {
        Module._free(cacheBuffer);
        cacheBuffer = null;
    }
}


