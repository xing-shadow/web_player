
class Player {
    constructor(playUrl, canvas) {
        this.playUrl = playUrl
        this.canvas = canvas
        this.pcmPlayer = new PCMPlayer({})
        this.webGLPlayer = new WebGLPlayer(this.canvas, {})
        this.decodeWorker = null
        this.ws = null
        this.initDecodeWorker()
    }
    initDecodeWorker() {
        this.decodeWorker = new Worker('decoder.js')
        this.decodeWorker.onerror = (e) => {
            console.error('Worker error:', e.message, e.filename, e.error, e.lineno)
        }
        this.decodeWorker.onmessageerror = (e) => {
            console.error('Message error in worker:', e)
        }
        this.decodeWorker.onmessage = (evt) => {
            const objData = evt.data
            if (objData.isVideo) {
                this.displayVideoFrame(objData)
            } else {
                this.displayAudioFrame(objData)
            }
        }
    }
    displayVideoFrame(obj) {
        if (this.webGLPlayer) {
            console.info('播放视频:' + obj.pts)
            const data = new Uint8Array(obj.data)
            let width = obj.width
            let height = obj.height
            let yLength = width * height
            let uvLength = (width / 2) * (height / 2)
            this.webGLPlayer.renderFrame(data, width, height, yLength, uvLength)
        }
    }
    displayAudioFrame(obj) {
        if (this.pcmPlayer) {
            console.info('播放音频:' + obj.pts)
            this.pcmPlayer.play(obj.data)
        }
    }
    play() {
        this.ws = new WebSocket(this.playUrl)
        this.ws.onopen = () => {
            console.info('WebSocket connection opened')
        }
        let frameType,
            isKey,
            pts,
            frameLen,
            got = 0
        let frame = null
        this.ws.onmessage = async (event) => {
            const arrayBuffer = await event.data.arrayBuffer()
            const data = new Uint8Array(arrayBuffer)
            if (data.byteLength === 14) {
                //解析头数据
                let offset = 0
                const view = new DataView(data.buffer)

                frameType = view.getUint8(offset)
                offset += 1

                isKey = view.getUint8(offset)
                offset += 1

                pts = view.getBigUint64(offset, false)
                offset += 8
                frameLen = view.getUint32(offset, false)
                //初始化
                frame = new Uint8Array(frameLen)
                got = 0
            } else {
                frame.set(data, got)
                got += data.byteLength
            }
            if (got === frameLen) {
                const objData = {
                    frameType: frameType,
                    frame: frame,
                    pts: pts,
                }
                this.decodeWorker.postMessage(objData)
                //
                frameType = 0
                frameLen = 0
                frame = null
                isKey = 0
                got = 0
                pts = 0
            }
        }

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error)
        }

        this.ws.onclose = () => {
            console.info('WebSocket connection closed')
        }
    }
}
