
const NodeCoreUtils = require('./node_core_utils');
const context = require('./node_core_ctx');
const Logger = require('./node_core_logger');

const rtpPackets = new Map();

class NodeGB28181StreamServerSession {
    constructor(config, socket) {
        this.config = config;
        this.socket = socket;
        this.id = NodeCoreUtils.generateNewSessionID();
        this.ip = socket.remoteAddress;
        this.parserBuffer = Buffer.alloc(0);
        this.TAG = 'rtpovertcp';
        this.sequenceNumber = 0;
        this.cache = Buffer.alloc(0);

        context.sessions.set(this.id, this);
    }

    run() {
        this.socket.on('data', this.onSocketData.bind(this));
        this.socket.on('close', this.onSocketClose.bind(this));
        this.socket.on('error', this.onSocketError.bind(this));
        this.socket.on('timeout', this.onSocketTimeout.bind(this));

        this.isStarting = true;
        this.connectTime = new Date();

        this.connectCmdObj = { ip: this.ip };

        Logger.log(`[${this.TAG} connect] id=${this.id} ip=${this.ip} `);

        if (!this.isStarting) {
            this.stop();
            return;
        }
    }

    stop() {
        if (this.isStarting) {
            this.isStarting = false;
            this.socket.end();
            Logger.log(`[${this.TAG} disconnect] id=${this.id}`);
            context.sessions.delete(this.id);
        }
    }

    onSocketClose() {
        this.stop();
    }

    onSocketError(e) {
        this.stop();
    }

    onSocketTimeout() {
        this.stop();
    }

    onSocketData(data) {
        this.parserBuffer = Buffer.concat([this.parserBuffer, data]);
        //国标28181的tcp码流标准遵循的是RFC4571标准

        //RFC2326标准格式： $+长度+RTP头+数据
        //RFC4571标准格式: 长度+RTP头+数据

        let index = this.parserBuffer.indexOf("$");

        if (index != -1) {
            let channel = this.parserBuffer.readUInt8(index);
            let rtplength = this.parserBuffer.readUInt16BE(index + 1);

            if (this.parserBuffer.length < index + 3 + rtplength) {
                return;
            }

            let rtpBuf = Buffer.alloc(rtplength);
            this.parserBuffer.copy(rtpBuf, 0, index + 3, index + 3 + rtplength);
            //跳过
            this.parserBuffer = this.parserBuffer.slice(index + 3 + rtplength);

            let rtppacket = NodeGB28181StreamServerSession.parseRtpPacket(rtpBuf);

            if (sessions.size == 0) {
                this.first = rtppacket.sequenceNumber;
            }

            rtpPackets.set(rtppacket.sequenceNumber, rtppacket);

            if (rtpPackets.has(rtppacket.sequenceNumber - 1)) {
                let last = rtpPackets.get(rtppacket.sequenceNumber - 1);
                if (last.timestamp != rtppacket.timestamp) {
                    let first = this.first;
                    this.first = rtppacket.sequenceNumber;

                    switch (last.payloadType) {
                        //PS
                        case 96:
                            let psdata = Buffer.alloc(0);
                            let lost = false;
                            while (first <= last.sequenceNumber) {
                                if (rtpPackets.has(first)) {
                                    psdata = Buffer.concat([psdata, rtpPackets.get(first).payload]);
                                    rtpPackets.delete(first);
                                }
                                else {
                                    lost = true;
                                    Logger.log(`lost frame timestamp:${timestamp}`);
                                    break;
                                }
                                first++;
                            }

                            if (!lost) {
                                let packet = NodeGB28181StreamServerSession.parseMpegPSPacket(psdata);
                                context.nodeEvent.emit('rtpReceived', last.ssrc, last.timestamp, packet);
                            }
                            break;
                        //TS
                        case 97:
                            break;
                        //H264
                        case 98:
                            break;
                    }
                }
            }
        }
    }

    //解析 PS 获取Nalus video/audio/streaminfo
    static parseMpegPSPacket(buf, offset) {

        let position = offset || 0;

        //PSM 编码信息
        let streaminfo = {};

        //PES-video-payload-nalus
        let naluscache = Buffer.alloc(0);

        //PES-audio-payload
        let audiocache = Buffer.alloc(0);

        //读取PES
        while (buf.length - 6 > position) {

            let Identifier = buf.readUInt32BE(position);

            position += 4;

            if (Identifier == 0x01ba) {

                //系统时钟基准（6）+PS复用速率（4）
                position += 9;

                //填充头长度
                let pack_stuffing_length = (buf.readUInt8(position) & 0x07);
                position += 1;
                position += pack_stuffing_length;

                if (position > buf.length)
                    break;
            }

            //System Header 0xbb
            if (Identifier == 0x01bb) {
   
                //系统标题头长度
                let header_length = (buf.readUInt8(position) << 8 | buf.readUInt8(position + 1));
                position += 2;
                position += header_length;

                if (position > buf.length)
                    break;
            }

            //PSM 0xbc 解包判断音/视频编码 类型
            if (Identifier == 0x01bc) {

                //PES-length
                let pes_packet_length = (buf.readUInt8(position) << 8 | buf.readUInt8(position + 1));
                position += 2;

                let program_stream_info_length = buf.readUInt16BE(position + 2);
                let elementary_stream_map_length = buf.readUInt16BE(position + 4);

                let start = 6 + program_stream_info_length;
                let end = 6 + program_stream_info_length + elementary_stream_map_length;

                while (start < end) {

                    let stream_type = buf.readUInt8(position + start++);
                    let elementary_stream_id = buf.readUInt8(position + start++);
                    let elmentary_stream_info_length = buf.readUInt8(position + start++) << 8 | buf.readUInt8(position + start++);

                    if (elementary_stream_id >= 0xc0 && elementary_stream_id <= 0xdf)
                        streaminfo.audio = stream_type;

                    if (elementary_stream_id >= 0xe0 && elementary_stream_id <= 0xef)
                        streaminfo.video = stream_type;

                    start += elmentary_stream_info_length;
                }

                position += pes_packet_length;

                if (position > buf.length)
                    break;
            }

            if (Identifier >= 0x01e0 && Identifier <= 0x01ef) {

                //PES-length
                let pes_packet_length = (buf.readUInt8(position) << 8 | buf.readUInt8(position + 1));
                position += 2;

                //PES packet header
                let pes_header_length = buf.readUInt8(position + 2) + 3;
                //视频数据
                let data = buf.slice(position + pes_header_length, position + pes_packet_length);

                naluscache = Buffer.concat([naluscache, data]);

                position += pes_packet_length;

                if (position > buf.length)
                    break;
            }

            if (Identifier >= 0x01c0 && Identifier <= 0x01df) {

                //PES-length
                let pes_packet_length = (buf.readUInt8(position) << 8 | buf.readUInt8(position + 1));
                position += 2;

                //PES packet header
                let pes_header_length = buf.readUInt8(position + 2) + 3;
                //音频数据
                let data = buf.slice(position + pes_header_length, position + pes_packet_length);
                audiocache = Buffer.concat([audiocache, data]);

                position += pes_packet_length;

                if (position > buf.length)
                    break;
            }
        }

        //读取完毕分析nalus
        position = 0;

        let indexs = [];

        //视频Nalues
        let nalus = [];

        while (naluscache.length - 4 > position) {
            if (naluscache.readUInt32BE(position) == 1) {
                indexs.push(position);
                position += 4;

                if (indexs.length > 1) {
                    let nalu = naluscache.slice(indexs[indexs.length - 2] + 4, indexs[indexs.length - 1]);
                    nalus.push(nalu);
                }
            }

            position++;
        }

        if (indexs.length > 0) {
            let nalu = naluscache.slice(indexs[indexs.length - 1] + 4);
            nalus.push(nalu);
        }

        return { video: nalus, audio: audiocache, streaminfo: streaminfo };
    }

    //RTPPacket
    static parseRtpPacket(buf) {

        if (buf.length < 12)
            throw new Error('can not parse buffer smaller than fixed header');

        var firstByte = buf.readUInt8(0);
        var secondByte = buf.readUInt8(1);
        var version = firstByte >> 6;
        var padding = (firstByte >> 5) & 1;
        var extension = (firstByte >> 4) & 1;
        var csrcCount = firstByte & 0x0f;
        var marker = secondByte >> 7;
        var payloadType = secondByte & 0x7f;
        var sequenceNumber = buf.readUInt16BE(2);
        var timestamp = buf.readUInt32BE(4);
        var ssrc = buf.readUInt32BE(8);

        var offset = 12;
        var end = buf.length;
        if (end - offset >= 4 * csrcCount) {
            offset += 4 * csrcCount;
        } else {
            Logger.log(`no enough space for csrc`);
        }
        if (extension) {
            if (end - offset >= 4) {
                var extLen = 4 * (buf.readUInt16BE(offset + 2));
                offset += 4;
                if (end - offset >= extLen) {
                    offset += extLen;
                } else {
                    Logger.log(`no enough space for extension data`);
                }
            } else {
                Logger.log(`no enough space for extension header`);
            }
        }
        if (padding) {
            if (end - offset > 0) {
                var paddingBytes = buf.readUInt8(end - 1);
                if (end - offset >= paddingBytes) {
                    end -= paddingBytes;
                }
            }
        }

        var parsed = {
            version: version,
            padding: padding,
            extension: extension,
            csrcCount: csrcCount,
            marker: marker,
            payloadType: payloadType,
            sequenceNumber: sequenceNumber,
            timestamp: timestamp,
            ssrc: ssrc,
            payload: buf.slice(offset, end)
        };

        return parsed;
    }

}

module.exports = NodeGB28181StreamServerSession;