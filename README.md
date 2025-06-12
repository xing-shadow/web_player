# web播放器

- 实现websocket 接收音视频数据
- 实现ffmpeg wasm 实现对h65,h264 annexb raw data 的解码
- 实现ffmpeg wasm 实现对pcma 的解码
- 实现web worker 解码音视频数据
- 实现webcodecs h65,h264 annexb硬解码
- 实现音视频同步
# 测试
- websocket 服务启动
  go run main.go
- 浏览器打开js/videoPlay.html
