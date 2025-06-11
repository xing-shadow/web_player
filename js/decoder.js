self.Module = {
    onRuntimeInitialized: async function () {
        await self.decoder.onWasmLoaded()
    }
};

self.importScripts("web_decoder.js");

class Decoder {
    constructor() {
        this.videoCallback = null
        this.audioCallback = null
        this.wasmLoaded = -1
        this.alawDecoder = null
        this.avcDecoder = null
        this.hevcDecoder = null
        this.audioTimestamp = 0
    }

    async onWasmLoaded() {
        //初始化硬解码器
        // const alawCfg =await GetAlawConfig()
        // if (alawCfg) {
        //     this.alawDecoder = new AudioDecoder({
        //         output: (frame) => {
        //             const buffer = new Uint8Array(frame.allocationSize({ planeIndex: 0 }))
        //             frame.copyTo(buffer, { planeIndex: 0 })
        //             this.audioTimestamp += buffer.length / 16
        //             console.log('接受到音频帧',this.audioTimestamp)
        //             var objData = {
        //                 pts: this.audioTimestamp,
        //                 data: buffer,
        //                 isVideo: false,
        //             }
        //             self.postMessage(objData)
        //             frame.close()
        //         },
        //         error: (e) => console.error('AudioDecoder error:', e),
        //     })
        //     this.alawDecoder.configure(alawCfg)
        // }
        const avcCfg = await GetH264Config()
        if (avcCfg) {
            this.avcDecoder = new VideoDecoder({
                output: async (frame) => {
                    console.log('接受到视频帧')
                    // 获取所需缓冲区大小
                    const size = frame.allocationSize({ format: 'I420' }) // 你也可以使用 'RGBA'
                    const buffer = new Uint8Array(size)

                    // 复制像素数据到 buffer 中
                    await frame.copyTo(buffer, { format: 'I420' }).then(()=> {
                        var objData = {
                            pts: frame.timestamp,
                            data: buffer,
                            width: frame.codedWidth,
                            height: frame.codedHeight,
                            isVideo: true,
                        }
                        self.postMessage(objData)
                        frame.close()
                    }).catch((err) => {
                        console.error('Error copying h264 frame:', err)
                        frame.close()
                    })

                },
                error: (e) => console.error('VideoDecoder error:', e),
            })
            this.avcDecoder.configure(avcCfg)
        }
        const hevcCfg = await GetHevcConfig()
        if (hevcCfg) {
            this.hevcDecoder = new VideoDecoder({
                output: async (frame) => {
                    console.log('接受到视频帧')
                    // 获取所需缓冲区大小
                    const size = frame.allocationSize({ format: 'I420' }) // 你也可以使用 'RGBA'
                    const buffer = new Uint8Array(size)
                    // 复制像素数据到 buffer 中
                    frame.copyTo(buffer, { format: 'I420' }).then(()=> {
                        var objData = {
                            pts: frame.timestamp,
                            data: buffer,
                            width: frame.codedWidth,
                            height: frame.codedHeight,
                            isVideo: true,
                        }
                        self.postMessage(objData)
                        frame.close()
                    }).catch((err) => {
                        console.error('Error copying h265 frame:', err)
                        frame.close()
                    })
                },
                error: (e) => console.error('VideoDecoder error:', e),
            })
            this.hevcDecoder.configure(hevcCfg)
        }
        //初始化软解码器
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
        let ret = Module._openDecoder(
            this.videoCallback,
            this.audioCallback,
            1,
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
    decodeH264Data(data, pts,isKey) {
        if (this.wasmLoaded !== 0) {
            return
        }
        if (this.avcDecoder) {
            const videoChunk = new EncodedVideoChunk({
                timestamp: Number(pts),
                type: isKey === 1 ? 'key' : 'delta',
                data: data,
            })
            this.avcDecoder.decode(videoChunk)
            return;
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
    decodeH265Data(data, pts,isKey) {
        if (this.wasmLoaded !== 0) {
            return
        }
        if (this.hevcDecoder) {
            const videoChunk = new EncodedVideoChunk({
                timestamp: Number(pts),
                type: isKey === 1 ? 'key' : 'delta',
                data: data,
            })
            this.hevcDecoder.decode(videoChunk)
            return;
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
        // if (this.alawDecoder) {
        //     const audioChunk = new EncodedAudioChunk({
        //         timestamp: Number(pts),
        //         type: 'key',
        //         data: data,
        //     })
        //     this.alawDecoder.decode(audioChunk)
        //     return;
        // }
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
            self.decoder.decodeH264Data(objData.frame, objData.pts,objData.isKey)
            break
        case 0x02:
            self.decoder.decodeH265Data(objData.frame, objData.pts,objData.isKey)
            break
        case 0x04:
            self.decoder.decodePcmaData(objData.frame, objData.pts)
            break
    }
}


/*
*  硬件解码
* */

// 检查 HEVC 解码支持
async function CheckHEVCMainDecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Main: `hev1.1.6.L93.B0`
         * Main 10: `hev1.2.4.L93.B0`
         * Main still-picture: `hvc1.3.E.L93.B0`
         * Range extensions: `hvc1.4.10.L93.B0`
         */
        codec: 'hev1.1.6.L93.B0',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

async function CheckHEVCMain10DecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Main: `hev1.1.6.L93.B0`
         * Main 10: `hev1.2.4.L93.B0`
         * Main still-picture: `hvc1.3.E.L93.B0`
         * Range extensions: `hvc1.4.10.L93.B0`
         */
        codec: 'hev1.2.4.L93.B0',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

async function CheckHEVCStillPictureDecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Main: `hev1.1.6.L93.B0`
         * Main 10: `hev1.2.4.L93.B0`
         * Main still-picture: `hvc1.3.E.L93.B0`
         * Range extensions: `hvc1.4.10.L93.B0`
         */
        codec: 'hvc1.3.E.L93.B0',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

async function CheckHEVCRangeExtensionsDecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Main: `hev1.1.6.L93.B0`
         * Main 10: `hev1.2.4.L93.B0`
         * Main still-picture: `hvc1.3.E.L93.B0`
         * Range extensions: `hvc1.4.10.L93.B0`
         */
        codec: 'hvc1.4.10.L93.B0',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

// 检查 alaw 编码支持
async function CheckAlawEncodeSupport() {
    return await AudioDecoder.isConfigSupported({
        codec: 'alaw',
        numberOfChannels: 1,
        sampleRate: 8000,
    })
}

// 检查 H264 解码支持
async function CheckH264BaselineDecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Baseline : `avc1.42001E`
         * Main Profile: `vc1.4D401E`
         * High Profile: `avc1.64001F`
         */
        codec: 'hev1.1.6.L93.B0',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

async function CheckH264MainDecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Baseline : `avc1.42001E`
         * Main Profile: `avc1.4D401E`
         * High Profile: `avc1.64001F`
         */
        codec: 'hev1.1.6.L93.B0',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

async function CheckH264HighDecodeSupport() {
    return await VideoDecoder.isConfigSupported({
        /**
         * 视频的 Profile
         *
         * Baseline : `avc1.42001E`
         * Main Profile: `avc1.4D401E`
         * High Profile: `avc1.64001F`
         */
        codec: 'avc1.64001F',
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
    })
}

async function GetHevcConfig() {
    let res;
    res = await CheckHEVCMainDecodeSupport()
    if (res.supported) {
        return {
            codec: 'hev1.1.6.L93.B0',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    res = await CheckHEVCMain10DecodeSupport()
    if (res.supported) {
        return {
            codec: 'hev1.2.4.L93.B0',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    res = await CheckHEVCStillPictureDecodeSupport()
    if (res.supported) {
        return {
            codec: 'hvc1.3.E.L93.B0',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    res = await CheckHEVCRangeExtensionsDecodeSupport()
    if (res.supported) {
        return {
            codec: 'hvc1.4.10.L93.B0',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    return null
}

async function GetH264Config() {
    let res
    res = await CheckH264BaselineDecodeSupport()
    if (res.supported) {
        return {
            codec: 'avc1.42001E',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    res = await CheckH264MainDecodeSupport()
    if (res.supported) {
        return {
            codec: 'avc1.4D401E',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    res = await CheckH264HighDecodeSupport()
    if (res.supported) {
        return {
            codec: 'avc1.64001F',
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
        }
    }
    return null
}

async function GetAlawConfig() {
    const res = await CheckAlawEncodeSupport()
    if (res.supported) {
        return {
            codec: 'alaw',
            numberOfChannels: 1,
            sampleRate: 8000,
        }
    }
    return null
}