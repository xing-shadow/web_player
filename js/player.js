const playerStatePlaying        = 1;
const playerStatePausing        = 2;

class Player {
    constructor(playUrl, canvas) {
        this.playUrl = playUrl
        this.canvas = canvas
        this.pcmPlayer = new PCMPlayer({})
        this.webGLPlayer = null
        this.decodeWorker = null
        this.ws = null
        this.initDecodeWorker()
        //音视频同步
        this.audioStartTime = null
        this.firstAudioPts = null
        this.videoQueue = [] // 视频帧队列
        this.audioQueue = [] //音频帧队列
        this.syncTimer = null
        this.playerState = playerStatePausing
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
                if (!this.webGLPlayer) {
                    this.webGLPlayer = new WebGLPlayer(this.canvas, {format: objData.format})
                }
                this.videoQueue.push(objData)
            } else {
                if (!this.audioStartTime) {
                    this.audioStartTime = this.pcmPlayer.getCurrentTime() // eg. AudioContext.currentTime
                    this.firstAudioPts = Number(objData.pts)
                    this.startSyncLoop()
                }
                this.audioQueue.push(objData)
            }
        }
    }
    displayVideoFrame(obj) {
        if (this.webGLPlayer) {
            if (this.playerState !== playerStatePlaying) {
                return false;
            }
            let width = obj.width
            let height = obj.height
            this.webGLPlayer.renderFrame(obj.data,obj.format, width, height)
        }
    }
    displayAudioFrame(obj) {
        if (this.pcmPlayer) {
            this.pcmPlayer.play(obj.data)
        }
    }
    getState() {
        return this.playerState;
    }
    play() {
        if (this.playerState === playerStatePlaying ) {
            return
        }else {
            this.pcmPlayer.volume(1);
            this.playerState = playerStatePlaying
        }
        if (this.ws != null) {
            return
        }
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
                try {
                    frame = new Uint8Array(frameLen)
                    got = 0
                }catch (e) {
                    console.log(e,event)
                }
            } else {
                frame.set(data, got)
                got += data.byteLength
            }
            if (got === frameLen) {
                const objData = {
                    frameType: frameType,
                    frame: frame,
                    isKey:isKey,
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
            this.ws = null
            console.info('WebSocket connection closed')
        }
    }
    pause() {
        if (this.playerState === playerStatePausing) {
            return
        }else {
            this.playerState = playerStatePausing
        }
        if (this.pcmPlayer) {
            this.pcmPlayer.volume(0);
        }
    }
    startSyncLoop() {
        this.syncTimer = setInterval(() => {
            const now = this.pcmPlayer.getCurrentTime()
            const currentPts = (now - this.audioStartTime) * 1000
            //视频同步
            this.videoQueue.sort((a, b) => Number(a.pts) - Number(b.pts))
            while (this.videoQueue.length > 0) {
                const frame = this.videoQueue[0]
                if (Number(frame.pts) - currentPts <=0) {
                    this.videoQueue.shift()
                    this.displayVideoFrame(frame)
                }else {
                    break
                }
            }
            // 同步播放音频
            while (this.audioQueue.length > 0) {
                const audioFrame = this.audioQueue[0]
                this.audioQueue.shift()
                this.displayAudioFrame(audioFrame)
            }
        }, 10) // 每 10ms 检查一次


    }
    fullscreen() {
        this.webGLPlayer.fullscreen()
    }
}
