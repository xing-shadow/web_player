self.Module = {
    onRuntimeInitialized: function () {
        self.decoder.onWasmLoaded()
    }
};

self.importScripts("web_decoder.js");

class Decoder {
    constructor() {
        this.videoCallback = null
        this.audioCallback = null
        this.wasmLoaded = -1
    }

    onWasmLoaded() {
        this.videoCallback = Module.addFunction(function (buff, size, weight, height, timestamp) {
            var outArray = Module.HEAPU8.subarray(buff, buff + size)
            var data = new Uint8Array(outArray)
            var objData = {
                pts: timestamp,
                data: data,
                width: weight,
                height: height,
                isVideo: true,
            }
            self.postMessage(objData)
        }, 'vpiiij')
        this.audioCallback = Module.addFunction(function (buff, size, timestamp) {
            var outArray = Module.HEAPU8.subarray(buff, buff + size)
            var data = new Uint8Array(outArray)
            var objData = {
                pts: timestamp,
                data: data,
                isVideo: false,
            }
            self.postMessage(objData)
        }, 'vpij')
        //初始化解码器
        let ret = Module._openDecoder(
            this.videoCallback,
            this.audioCallback,
            2,
        )
        if (ret === 0) {
            console.log('openDecoder success')
        } else {
            Module.error('openDecoder failed with error', ret)
        }
        //加载完成
        this.wasmLoaded = 0
        console.info('wasm loaded')
    }
    decodeH264Data(data, pts) {
        if (this.wasmLoaded !== 0) {
            return
        }
        // Get the length of the data and allocate memory for it.
        let size = data.length
        let cacheBuffer = Module._malloc(size)
        // Set the data into the allocated memory.
        Module.HEAPU8.set(data, cacheBuffer)
        // Call the decodeData function with the allocated memory, size, and timestamp.
        Module._decodeH264Data(cacheBuffer, size, pts)
        // If the cacheBuffer is not null, free the memory.
        if (cacheBuffer != null) {
            Module._free(cacheBuffer)
            cacheBuffer = null
        }
    }
    decodeH265Data(data, pts) {
        if (this.wasmLoaded !== 0) {
            return
        }
        // Get the length of the data and allocate memory for it.
        let size = data.length
        let cacheBuffer = Module._malloc(size)
        // Set the data into the allocated memory.
        Module.HEAPU8.set(data, cacheBuffer)

        // Call the decodeData function with the allocated memory, size, and timestamp.
        Module._decodeH265Data(cacheBuffer, size, pts)
        // If the cacheBuffer is not null, free the memory.
        if (cacheBuffer != null) {
            Module._free(cacheBuffer)
            cacheBuffer = null
        }
    }
    decodePcmaData(data, pts) {
        if (this.wasmLoaded !== 0) {
            return
        }
        // Get the length of the data and allocate memory for it.
        let size = data.length
        let cacheBuffer = Module._malloc(size)
        // Set the data into the allocated memory.
        Module.HEAPU8.set(data, cacheBuffer)
        // Call the decodeData function with the allocated memory, size, and timestamp.
        Module._decodePcmaData(cacheBuffer, size, pts)
        // If the cacheBuffer is not null, free the memory.
        if (cacheBuffer != null) {
            Module._free(cacheBuffer)
            cacheBuffer = null
        }
    }
}

self.decoder = new Decoder();

self.onmessage = function (evt) {
    if (!self.decoder) {
        console.error('Decoder not initialized!')
        return
    }
    const objData = evt.data
    switch (objData.frameType) {
        case 0x01:
            self.decoder.decodeH264Data(objData.frame, objData.pts)
            break
        case 0x02:
            self.decoder.decodeH265Data(objData.frame, objData.pts)
            break
        case 0x04:
            self.decoder.decodePcmaData(objData.frame, objData.pts)
            break
    }
}
