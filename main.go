package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"github.com/alecthomas/kingpin/v2"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 1400
)

var (
	httpPort = new(int)

	logger = log.New(os.Stdout, "", log.LstdFlags)
)

func main() {
	var cmdParse = kingpin.New(filepath.Base(os.Args[0]), "")
	cmdParse.HelpFlag.Short('h')
	cmdParse.Flag("port", "http port").Short('p').Default("8080").IntVar(httpPort)
	_, err := cmdParse.Parse(os.Args[1:])
	if err != nil {
		panic("解析命令行参数失败" + err.Error())
	}
	route := gin.Default()
	route.GET("/ws/test", WebSocket)
	httpSrv := http.Server{
		Addr:    fmt.Sprintf(":%d", *httpPort),
		Handler: route,
	}
	err = httpSrv.ListenAndServe()
	if err != nil {
		panic("启动http服务失败" + err.Error())
	}
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGQUIT, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-quit:
		httpSrv.Shutdown(context.TODO())
	}
}

type WebSocketConn struct {
	cc     *websocket.Conn
	stop   bool
	header []byte
}

func WebSocket(ginCtx *gin.Context) {
	var upgrader = websocket.Upgrader{
		HandshakeTimeout: time.Second * 10,
		ReadBufferSize:   1500,
		WriteBufferSize:  1500,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
		Subprotocols: []string{ginCtx.Request.Header.Get("Sec-WebSocket-Protocol")},
	}
	conn := new(WebSocketConn)
	conn.header = make([]byte, 14)
	var err error
	conn.cc, err = upgrader.Upgrade(ginCtx.Writer, ginCtx.Request, nil)
	if err != nil {
		ginCtx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	go conn.Write()
	conn.Read()
}

func (c *WebSocketConn) Read() {
	c.cc.SetReadDeadline(time.Now().Add(pongWait))
	c.cc.SetPongHandler(func(string) error {
		c.cc.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for !c.stop {
		_, _, err := c.cc.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logger.Printf("websocket conn closed unexpectedly:%v\n", err)
			} else {
				logger.Printf("websocket conn ReadMessage error:%v\n", err)
			}
			break
		}
	}
}

type Frame struct {
	Pts      int64
	isIFrame bool
	Data     []byte
}

func (c *WebSocketConn) Write() {
	dir, _ := os.Getwd()
	h264Path := filepath.Join(dir, "test/test.h264")
	pcmaPath := filepath.Join(dir, "test/test.alaw")
	//
	var getVideoFrameFunc = func() func() (Frame, error) {
		h264F, err := os.ReadFile(h264Path)
		if err != nil {
			logger.Printf("read h264 file error:%v\n", err)
			c.Stop()
		}
		nalus, err := SplitNalusAnnexB(h264F)
		var vIndex int
		var sps, pps []byte
		var pts int64
		return func() (Frame, error) {
			for vIndex < len(nalus) {
				var naluType = nalus[vIndex][0] & 0x1f
				if naluType == 7 {
					sps = nalus[vIndex]
					vIndex++
					continue
				}
				if naluType == 8 {
					pps = nalus[vIndex]
					vIndex++
					continue
				}
				if naluType == 5 {
					pts += 40 //40ms 25fps
					frame := Frame{
						Pts:      pts,
						isIFrame: true,
						Data:     append([]byte{0, 0, 0, 1}, bytes.Join([][]byte{sps, pps, nalus[vIndex]}, []byte{0, 0, 0, 1})...),
					}
					vIndex++
					return frame, nil
				} else if naluType == 1 {
					pts += 40 //40ms 25fps
					frame := Frame{
						Pts:      pts,
						isIFrame: false,
						Data:     append([]byte{0, 0, 0, 1}, nalus[vIndex]...),
					}
					vIndex++
					return frame, nil
				} else {
					vIndex++
				}
			}
			return Frame{}, io.EOF
		}
	}
	var getAudioFrameFunc = func() func() (Frame, error) {
		var pts int64
		pcmaF, err := os.ReadFile(pcmaPath)
		if err != nil {
			logger.Printf("read pcm file error:%v\n", err)
			c.Stop()
		}
		pcmaLen := len(pcmaF)
		var i int
		return func() (Frame, error) {
			if i < pcmaLen {
				if i+320 <= pcmaLen {
					pts += 320 / 8 //40ms
					frame := Frame{
						Pts:      pts,
						isIFrame: false,
						Data:     pcmaF[i : i+320],
					}
					i += 320
					return frame, nil
				} else {
					pts += int64(pcmaLen-i) / 8
					frame := Frame{
						Pts:      pts,
						isIFrame: false,
						Data:     pcmaF[i:pcmaLen],
					}
					i = pcmaLen
					return frame, nil
				}
			} else {
				return Frame{}, io.EOF
			}
		}
	}

	ticker := time.NewTicker(pingPeriod)
	var getVideoFrame = getVideoFrameFunc()
	var getAudioFrame = getAudioFrameFunc()
	var videoEnd, audioEnd bool
	for !c.stop {
		select {
		case <-ticker.C:
			c.cc.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.cc.WriteMessage(websocket.PingMessage, nil); err != nil {
				logger.Printf("write ping message error:%v", err)
				return
			}
		default:
			break
		}
		if !videoEnd {
			videoFrame, err := getVideoFrame()
			if err != nil {
				logger.Println("video end")
				videoEnd = true
			} else {
				err = c.sendFrame(0x01, uint64(videoFrame.Pts), videoFrame.isIFrame, videoFrame.Data)
				if err != nil {
					c.Stop()
					logger.Printf("send video frame error:%v", err)
					break
				}
			}
		}
		if !audioEnd {
			audioFrame, err := getAudioFrame()
			if err != nil {
				logger.Println("audio end")
				audioEnd = true
			} else {
				err = c.sendFrame(0x04, uint64(audioFrame.Pts), audioFrame.isIFrame, audioFrame.Data)
				if err != nil {
					logger.Printf("send audio frame error:%v", err)
					c.Stop()
					break
				}
			}
		}
		if audioEnd && videoEnd {
			c.Stop()
			break
		}
	}

}
func (c *WebSocketConn) sendFrame(frameType byte, pts uint64, isIFrame bool, data []byte) (err error) {
	dataLen := len(data)
	// 发送帧头
	c.header[0] = frameType
	if isIFrame {
		c.header[1] = 0x01
	} else {
		c.header[1] = 0x00
	}
	binary.BigEndian.PutUint64(c.header[2:10], pts)
	binary.BigEndian.PutUint32(c.header[10:14], uint32(dataLen))
	//
	c.cc.SetWriteDeadline(time.Now().Add(writeWait))
	if err := c.cc.WriteMessage(websocket.BinaryMessage, c.header); err != nil {
		return fmt.Errorf("failed to send frame header: %w", err)
	}
	// 分片发送数据GF
	for i := 0; i < dataLen; i += maxMessageSize {
		end := i + maxMessageSize
		if end > dataLen {
			end = dataLen
		}
		fragment := data[i:end]
		if err := c.cc.WriteMessage(websocket.BinaryMessage, fragment); err != nil {
			return fmt.Errorf("failed to send data fragment: %w", err)
		}
	}
	return nil
}

func (c *WebSocketConn) Stop() {
	if !c.stop {
		c.stop = true
		if c.cc != nil {
			c.cc.Close()
		}
	}
}

// This function splits a H264Raw frame buffer into NALUs
func SplitNalusAnnexB(FrameBuff []byte) (nalus [][]byte, err error) {
	// Check if the frame buffer length is less than 4
	if len(FrameBuff) < 4 {
		// If so, return an error
		err = fmt.Errorf("Can't Find HeaderLen in H264Raw,The data length is too small ")
		return
	}
	// Get the first 3 bytes of the frame buffer
	val3 := U24BE(FrameBuff)
	// Get the first 4 bytes of the frame buffer
	val4 := U32BE(FrameBuff)
	// is Annex B
	if val3 == 1 || val4 == 1 {
		_val3 := val3
		_val4 := val4
		start := 0 //nalu起始码起始位置
		pos := 0   //nalu起始码结束位置
		for {
			if start != pos {
				nalus = append(nalus, FrameBuff[start:pos])
			}
			if _val3 == 1 {
				pos += 3
			} else if _val4 == 1 {
				pos += 4
			}
			start = pos
			if start == len(FrameBuff) {
				break
			}
			_val3 = 0
			_val4 = 0
			for pos < len(FrameBuff) {
				if pos+2 < len(FrameBuff) && FrameBuff[pos] == 0 { //开始寻找下一个起始码的00
					_val3 = U24BE(FrameBuff[pos:])
					if _val3 == 0 {
						if pos+3 < len(FrameBuff) {
							_val4 = uint32(FrameBuff[pos+3])
							if _val4 == 1 {
								break
							}
						}
					} else if _val3 == 1 {
						break
					}
					pos++
				} else {
					pos++
				}
			}
		}
		if len(nalus) == 0 {
			err = fmt.Errorf("Can't Find HeaderLen in H264Raw Annex B end ")
		}
		return
	}
	err = fmt.Errorf("Can't Find HeaderLen in H264Raw end ")
	return
}

func U24BE(b []byte) (i uint32) {
	i = uint32(b[0])
	i <<= 8
	i |= uint32(b[1])
	i <<= 8
	i |= uint32(b[2])
	return
}

func U32BE(b []byte) (i uint32) {
	i = uint32(b[0])
	i <<= 8
	i |= uint32(b[1])
	i <<= 8
	i |= uint32(b[2])
	i <<= 8
	i |= uint32(b[3])
	return
}
