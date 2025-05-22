/**
  * @file
  * video decoding with libavcodec API example
  *
  * decode_video.c
  */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <sys/timeb.h>

typedef void (*VideoCallback)(unsigned char* buff, int size, int weigth, int height, int64_t pts);
typedef void (*AudioCallback)(unsigned char* buff, int size, unsigned long long pts);

#include <libavcodec/avcodec.h>

const int kInitialPcmBufferSize = 128 * 1024;

typedef enum ErrorCode
{
    kErrorCode_Success = 0,
    kErrorCode_Invalid_Param,
    kErrorCode_Invalid_Data,
    kErrorCode_Invalid_Format,
    kErrorCode_NULL_Pointer,
    kErrorCode_Alloc_Failed,
    kErrorCode_FFmpeg_Error
} ErrorCode;

typedef enum LogLevel
{
    kLogLevel_None, //Not logging.
    kLogLevel_Core, //Only logging core module(without ffmpeg).
    kLogLevel_All //Logging all, with ffmpeg.
} LogLevel;

typedef enum FrameType
{
    Video_Frame,
    Audio_Frame,
} FrameType;


LogLevel logLevel = kLogLevel_None;

void simpleLog(const char* format, ...)
{
    if (logLevel == kLogLevel_None)
    {
        return;
    }

    char szBuffer[1024] = {0};
    char szTime[32] = {0};
    char* p = NULL;
    int prefixLength = 0;
    const char* tag = "Core";
    struct tm tmTime;
    struct timeb tb;

    ftime(&tb);
    localtime_r(&tb.time, &tmTime);
    if (1)
    {
        int tmYear = tmTime.tm_year + 1900;
        int tmMon = tmTime.tm_mon + 1;
        int tmMday = tmTime.tm_mday;
        int tmHour = tmTime.tm_hour;
        int tmMin = tmTime.tm_min;
        int tmSec = tmTime.tm_sec;
        int tmMillisec = tb.millitm;
        sprintf(szTime, "%d-%d-%d %d:%d:%d.%d", tmYear, tmMon, tmMday, tmHour, tmMin, tmSec, tmMillisec);
    }

    prefixLength = sprintf(szBuffer, "[%s][%s][DT] ", szTime, tag);
    p = szBuffer + prefixLength;

    if (1)
    {
        va_list ap;
        va_start(ap, format);
        vsnprintf(p, 1024 - prefixLength, format, ap);
        va_end(ap);
    }

    printf("%s\n", szBuffer);
}

void ffmpegLogCallback(void* ptr, int level, const char* fmt, va_list vl)
{
    static int printPrefix = 1;
    static int count = 0;
    static char prev[1024] = {0};
    char line[1024] = {0};
    static int is_atty;
    AVClass* avc = ptr ? *(AVClass**)ptr : NULL;
    if (level > AV_LOG_DEBUG)
    {
        return;
    }

    line[0] = 0;

    if (printPrefix && avc)
    {
        if (avc->parent_log_context_offset)
        {
            AVClass** parent = *(AVClass***)(((uint8_t*)ptr) + avc->parent_log_context_offset);
            if (parent && *parent)
            {
                snprintf(line, sizeof(line), "[%s @ %p] ", (*parent)->item_name(parent), parent);
            }
        }
        snprintf(line + strlen(line), sizeof(line) - strlen(line), "[%s @ %p] ", avc->item_name(ptr), ptr);
    }

    vsnprintf(line + strlen(line), sizeof(line) - strlen(line), fmt, vl);
    line[strlen(line) + 1] = 0;
    simpleLog("%s", line);
}

ErrorCode initBuffer(int pix_fmt, int width, int height);
ErrorCode copyYuvData(AVFrame* frame, unsigned char* buffer, int width, int height);

static ErrorCode decode(AVCodecContext* dec_ctx, AVFrame* frame, AVPacket* pkt, int64_t pts, FrameType frame_type);

typedef struct WebDecoder
{
    //
    const AVCodec* h264Codec;
    AVCodecParserContext* h264Parser;
    AVCodecContext* h264CodecCtx;
    //
    const AVCodec* h265Codec;
    AVCodecParserContext* h265Parser;
    AVCodecContext* h265CodecCtx;
    //
    const AVCodec* pcmaCodec;
    AVCodecContext* pcmaCodecCtx;
    //
    AVPacket* v_pkt;
    AVFrame* v_frame;
    AVPacket* a_pkt;
    AVFrame* a_frame;
    //
    VideoCallback videoCallback;
    AudioCallback audioCallback;
    //
    unsigned char* yuvBuffer;
    unsigned char* pcmBuffer;
    int currentPcmBufferSize;
    int8_t initBufferFlag;
    int videoSize;
} WebDecoder;

WebDecoder* decoder = NULL;


ErrorCode openDecoder(long videoback, long audioback, int logLv)
{
    decoder = (WebDecoder*)av_mallocz(sizeof(WebDecoder));
    decoder->initBufferFlag = -1;
    ErrorCode ret = kErrorCode_Success;
    do
    {
        logLevel = logLv;
        simpleLog("Initialize decoder.");
        if (logLevel == kLogLevel_All)
        {
            av_log_set_callback(ffmpegLogCallback);
        }
        //h264解码器
        decoder->h264Codec = avcodec_find_decoder(AV_CODEC_ID_H264);
        if (decoder->h264Codec == NULL)
        {
            simpleLog("h264 codec not found\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->h264Parser = av_parser_init(decoder->h264Codec->id);
        if (decoder->h264Parser == NULL)
        {
            simpleLog("h264 parser not found\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->h264CodecCtx = avcodec_alloc_context3(decoder->h264Codec);
        if (decoder->h264CodecCtx == NULL)
        {
            simpleLog("Could not allocate video h264 codec context\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        if (avcodec_open2(decoder->h264CodecCtx, decoder->h264Codec, NULL) < 0)
        {
            simpleLog("Could not open h264 codec\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        //h265解码器
        decoder->h265Codec = avcodec_find_decoder(AV_CODEC_ID_H265);
        if (decoder->h265Codec == NULL)
        {
            simpleLog("h265 codec not found\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->h265Parser = av_parser_init(decoder->h265Codec->id);
        if (decoder->h265Parser == NULL)
        {
            simpleLog("h265 parser not found\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->h265CodecCtx = avcodec_alloc_context3(decoder->h265Codec);
        if (decoder->h265CodecCtx == NULL)
        {
            simpleLog("Could not allocate h265 video codec context\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        if (avcodec_open2(decoder->h265CodecCtx, decoder->h265Codec, NULL) < 0)
        {
            simpleLog("Could not open h265 codec\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        //pcma解码器
        decoder->pcmaCodec = avcodec_find_decoder(AV_CODEC_ID_PCM_ALAW);
        if (decoder->pcmaCodec == NULL)
        {
            simpleLog("alaw codec not found\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->pcmaCodecCtx = avcodec_alloc_context3(decoder->pcmaCodec);
        if (decoder->pcmaCodecCtx == NULL)
        {
            simpleLog("Could not allocate alaw video codec context\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->pcmaCodecCtx->channels = 1;       // 或 2，视你数据而定
        decoder->pcmaCodecCtx->sample_rate = 8000; // G.711 通常是 8000Hz
        int openRet = avcodec_open2(decoder->pcmaCodecCtx, decoder->pcmaCodec, NULL);
        if (openRet < 0)
        {
            char errbuf[256];
            av_strerror(openRet, errbuf, sizeof(errbuf));
            simpleLog("Could not open alaw codec: %s\n", errbuf);
            ret = kErrorCode_FFmpeg_Error;
            break;
        }

        decoder->v_frame = av_frame_alloc();
        if (decoder->v_frame == NULL)
        {
            simpleLog("Could not allocate video frame\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->v_pkt = av_packet_alloc();
        if (decoder->v_pkt == NULL)
        {
            simpleLog("Could not allocate video packet\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }

        decoder->a_frame = av_frame_alloc();
        if (decoder->v_frame == NULL)
        {
            simpleLog("Could not allocate audio frame\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        decoder->a_pkt = av_packet_alloc();
        if (decoder->v_pkt == NULL)
        {
            simpleLog("Could not allocate audio packet\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }

        decoder->videoCallback = (VideoCallback)videoback;
        decoder->audioCallback = (AudioCallback)audioback;
    }
    while (0);
    if (ret != kErrorCode_Success && decoder != NULL)
    {
        av_freep(&decoder);
    }
    simpleLog("Decoder initialized %d.", ret);
    return ret;
}

ErrorCode decodeH264Data(unsigned char* data, size_t data_size, int64_t pts)
{
    ErrorCode ret = kErrorCode_Success;
    while (data_size > 0)
    {
        int size = av_parser_parse2(decoder->h264Parser, decoder->h264CodecCtx, &decoder->v_pkt->data,
                                    &decoder->v_pkt->size,
                                    data, data_size, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
        if (size < 0)
        {
            simpleLog("Error while parsing\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        data += size;
        data_size -= size;

        if (decoder->v_pkt->size)
        {
            ret = decode(decoder->h264CodecCtx, decoder->v_frame, decoder->v_pkt, pts, Video_Frame);
            if (ret != kErrorCode_Success)
            {
                break;
            }
        }
    }
    return ret;
}

ErrorCode decodeH265Data(unsigned char* data, size_t data_size, int64_t pts)
{
    ErrorCode ret = kErrorCode_Success;
    while (data_size > 0)
    {
        int size = av_parser_parse2(decoder->h265Parser, decoder->h265CodecCtx, &decoder->v_pkt->data,
                                    &decoder->v_pkt->size,
                                    data, data_size, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
        if (size < 0)
        {
            simpleLog("Error while parsing\n");
            ret = kErrorCode_FFmpeg_Error;
            break;
        }
        data += size;
        data_size -= size;

        if (decoder->v_pkt->size)
        {
            ret = decode(decoder->h265CodecCtx, decoder->v_frame, decoder->v_pkt, pts, Video_Frame);
            if (ret != kErrorCode_Success)
            {
                break;
            }
        }
    }
    return ret;
}

ErrorCode decodePcmaData(unsigned char* data, size_t data_size, int64_t pts)
{
    decoder->a_pkt->data = data;
    decoder->a_pkt->size = data_size;
    ErrorCode ret = decode(decoder->pcmaCodecCtx, decoder->a_frame, decoder->a_pkt, pts, Audio_Frame);
    return ret;
}

int roundUp(int numToRound, int multiple)
{
    return (numToRound + multiple - 1) & -multiple;
}


static ErrorCode decode(AVCodecContext* dec_ctx, AVFrame* frame, AVPacket* pkt, int64_t pts, FrameType frameType)
{
    ErrorCode res = kErrorCode_Success;
    int sampleSize = 0;

    int ret = avcodec_send_packet(dec_ctx, pkt);
    if (ret < 0)
    {
        simpleLog("Error sending a packet for decoding\n");
        res = kErrorCode_FFmpeg_Error;
    }
    else
    {
        while (ret >= 0)
        {
            ret = avcodec_receive_frame(dec_ctx, frame);
            if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
            {
                break;
            }
            else if (ret < 0)
            {
                simpleLog("Error during decoding\n");
                res = kErrorCode_FFmpeg_Error;
                break;
            }
            if (frameType == Video_Frame)
            {
                res = initBuffer(dec_ctx->pix_fmt, dec_ctx->width, dec_ctx->height);
                if (res != kErrorCode_Success)
                {
                    simpleLog("initBuffer error");
                    break;
                }
                res = copyYuvData(frame, decoder->yuvBuffer, dec_ctx->width, dec_ctx->height);
                if (res != kErrorCode_Success)
                {
                    simpleLog("copyYuvData error");
                    break;
                }
                if (decoder->videoCallback != NULL)
                {
                    decoder->videoCallback(decoder->yuvBuffer, decoder->videoSize, dec_ctx->width, dec_ctx->height,
                                           pts);
                }
            }
            else
            {
                int audioDataSize = 0;
                sampleSize = av_get_bytes_per_sample(dec_ctx->sample_fmt);
                if (sampleSize < 0)
                {
                    simpleLog("Failed to calculate data size.");
                    res = kErrorCode_Invalid_Data;
                    break;
                }

                if (decoder->pcmBuffer == NULL)
                {
                    decoder->pcmBuffer = (unsigned char*)av_mallocz(kInitialPcmBufferSize);
                    decoder->currentPcmBufferSize = kInitialPcmBufferSize;
                    simpleLog("Initial PCM buffer size %d.", decoder->currentPcmBufferSize);
                }

                audioDataSize = frame->nb_samples * dec_ctx->channels * sampleSize;
                if (decoder->currentPcmBufferSize < audioDataSize)
                {
                    int targetSize = 0;
                    targetSize = roundUp(audioDataSize, 4);
                    simpleLog("Current PCM buffer size %d not sufficient for data size %d, round up to target %d.",
                              decoder->currentPcmBufferSize,
                              audioDataSize,
                              targetSize);
                    decoder->currentPcmBufferSize = targetSize;
                    av_free(decoder->pcmBuffer);
                    decoder->pcmBuffer = (unsigned char*)av_mallocz(decoder->currentPcmBufferSize);
                }
                int i = 0;
                int ch = 0;
                int offset = 0;
                for (i = 0; i < frame->nb_samples; i++)
                {
                    for (ch = 0; ch < dec_ctx->channels; ch++)
                    {
                        memcpy(decoder->pcmBuffer + offset, frame->data[ch] + sampleSize * i, sampleSize);
                        offset += sampleSize;
                    }
                }
                if (decoder->audioCallback != NULL)
                {
                    decoder->audioCallback(decoder->pcmBuffer, audioDataSize, pts);
                }
            }
        }
    }
    return res;
}


ErrorCode copyYuvData(AVFrame* frame, unsigned char* buffer, int width, int height)
{
    ErrorCode ret = kErrorCode_Success;
    unsigned char* src = NULL;
    unsigned char* dst = buffer;
    int i = 0;
    do
    {
        if (frame == NULL || buffer == NULL)
        {
            ret = kErrorCode_Invalid_Param;
            break;
        }

        if (!frame->data[0] || !frame->data[1] || !frame->data[2])
        {
            ret = kErrorCode_Invalid_Param;
            break;
        }

        for (i = 0; i < height; i++)
        {
            src = frame->data[0] + i * frame->linesize[0];
            memcpy(dst, src, width);
            dst += width;
        }

        for (i = 0; i < height / 2; i++)
        {
            src = frame->data[1] + i * frame->linesize[1];
            memcpy(dst, src, width / 2);
            dst += width / 2;
        }

        for (i = 0; i < height / 2; i++)
        {
            src = frame->data[2] + i * frame->linesize[2];
            memcpy(dst, src, width / 2);
            dst += width / 2;
        }
    }
    while (0);
    return ret;
}


ErrorCode flushDecoder()
{
    /* flush the decoder */
    ErrorCode ret = decode(decoder->h264CodecCtx, decoder->v_frame, NULL, 0, Video_Frame);
    if (ret != kErrorCode_Success)
    {
        return ret;
    }
    ret = decode(decoder->h265CodecCtx, decoder->v_frame, NULL, 0, Video_Frame);
    if (ret != kErrorCode_Success)
    {
        return ret;
    }
    ret = decode(decoder->pcmaCodecCtx, decoder->a_frame, NULL, 0, Video_Frame);
    if (ret != kErrorCode_Success)
    {
        return ret;
    }
    return kErrorCode_Success;
}

ErrorCode closeDecoder()
{
    ErrorCode ret = kErrorCode_Success;
    do
    {
        //
        if (decoder->h264Parser != NULL)
        {
            av_parser_close(decoder->h264Parser);
            simpleLog("Video h264 parser closed.");
        }
        if (decoder->h264CodecCtx != NULL)
        {
            avcodec_free_context(&decoder->h264CodecCtx);
            simpleLog("Video h264 codec context closed.");
        }
        //
        if (decoder->h265Parser != NULL)
        {
            av_parser_close(decoder->h265Parser);
            simpleLog("Video h265 parser closed.");
        }
        if (decoder->h265CodecCtx != NULL)
        {
            avcodec_free_context(&decoder->h265CodecCtx);
            simpleLog("Video h265 codec context closed.");
        }
        //
        if (decoder->pcmaCodecCtx != NULL)
        {
            avcodec_free_context(&decoder->pcmaCodecCtx);
            simpleLog("Audio pcma codec context closed.");
        }
        //
        if (decoder->v_frame != NULL)
        {
            av_frame_free(&decoder->v_frame);
        }
        if (decoder->v_pkt != NULL)
        {
            av_packet_free(&decoder->v_pkt);
        }
        if (decoder->yuvBuffer != NULL)
        {
            av_freep(decoder->yuvBuffer);
        }
        if (decoder->a_frame != NULL)
        {
            av_frame_free(&decoder->a_frame);
        }
        if (decoder->a_pkt != NULL)
        {
            av_packet_free(&decoder->a_pkt);
        }
        if (decoder->pcmBuffer != NULL)
        {
            av_freep(&decoder->pcmBuffer);
        }
        //
        if (decoder != NULL)
        {
            av_freep(&decoder);
        }
        simpleLog("All buffer released.");
    }
    while (0);

    return ret;
}

ErrorCode initBuffer(int pix_fmt, int width, int height)
{
    if (decoder->initBufferFlag == 0) // 已初始化，直接返回
    {
        return kErrorCode_Success;
    }

    if (pix_fmt != AV_PIX_FMT_YUV420P)
    {
        return kErrorCode_Invalid_Format;
    }

    decoder->videoSize = avpicture_get_size(pix_fmt, width, height);
    if (decoder->videoSize <= 0)
    {
        return kErrorCode_Invalid_Format; // 防御非法尺寸
    }

    decoder->yuvBuffer = (unsigned char*)av_mallocz(decoder->videoSize);
    if (decoder->yuvBuffer == NULL)
    {
        return kErrorCode_Alloc_Failed; // 分配失败
    }

    decoder->initBufferFlag = 0; // 设置为已初始化
    return kErrorCode_Success;
}


int main(int argc, char** argv)
{
    return 0;
}
