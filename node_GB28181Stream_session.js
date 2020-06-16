const context = require('./node_core_ctx');
const Logger = require('./node_core_logger');
const RtpPacket = require("rtp-rtcp").RtpPacket;

class NodeGB28181StreamServerSession {

    constructor(config, socket) {
        this.config = config;
        this.socket = socket;
        this.id = this.generateNewSessionID();
        this.ip = socket.remoteAddress;
        this.TAG = 'GB28181_TCP_Passive';

        context.sessions.set(this.id, this);
    }

    run() {
        this.socket.on('data', this.onSocketData.bind(this));
        this.socket.on('close', this.onSocketClose.bind(this));
        this.socket.on('error', this.onSocketError.bind(this));
        this.socket.on('timeout', this.onSocketTimeout.bind(this));

        this.isStarting = true;

        this.connectTime = new Date();

        Logger.log(`[${this.TAG} connect] id=${this.id} ip=${this.ip} `);

        this.cache = Buffer.alloc(0);

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

    //接收TCP 包
    onSocketData(data) {
        //国标28181的tcp码流标准遵循的是RFC4571标准
        //RFC2326标准格式： $+长度+RTP头+数据
        //RFC4571标准格式: 长度+RTP头+数据

        this.cache = Buffer.concat([this.cache, data]);

        while (this.cache.length > 1 && this.cache.length >= (this.cache.readUInt16BE(0) + 2)) {

            let rtplength = this.cache.readUInt16BE(0);

            let rtpData = this.cache.slice(2, rtplength + 2);

            NodeGB28181StreamServerSession.parseRTPacket(rtpData);

            this.cache = this.cache.slice(rtplength + 2);
        }

        //NodeGB28181StreamServerSession.parseTCPRTPacket(this.id, data);
    }

    //
    generateNewSessionID() {
        let sessionID = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWKYZ0123456789';
        const numPossible = possible.length;
        do {
            for (let i = 0; i < 8; i++) {
                sessionID += possible.charAt((Math.random() * numPossible) | 0);
            }
        } while (context.sessions.has(sessionID))
        return sessionID;
    }

    static rtpPackets = new Map();

    //补位0
    static PrefixInteger(num, m) {
        return (Array(m).join(0) + num).slice(-m);
    }

    //处理UDP/RTP包
    static parseRTPacket(cache) {

        let rtpPacket = new RtpPacket(cache);
        let ssrc = rtpPacket.getSSRC();
        let seqNumber = rtpPacket.getSeqNumber();
        let playloadType = rtpPacket.getPayloadType();
        let timestamp = rtpPacket.getTimestamp();
        let playload = rtpPacket.getPayload();

        if (!this.rtpPackets.has(ssrc))
            this.rtpPackets.set(ssrc, new Map());

        let session = this.rtpPackets.get(ssrc);

        Logger.log(`[${ssrc}] RTP Packet: timestamp:${timestamp} seqNumber:${seqNumber} length:${playload.length} `);

        switch (playloadType) {
            //PS封装
            case 96:
                {
                    if (!session.has(timestamp)) {
                        session.set(timestamp, playload);
                    }
                    else {
                        session.set(timestamp, Buffer.concat([session.get(timestamp), playload]));
                    }

                    //等待下一帧 收到，处理上一帧
                    if (session.size > 1) {

                        let entries = session.entries();

                        let first = entries.next().value;

                        let second = entries.next().value;

                        session.delete(first[0]);

                        try {
                            let packet = this.parseMpegPSPacket(first[1]);
                            context.nodeEvent.emit('rtpReadyed', this.PrefixInteger(ssrc, 10), second[0] - first[0], packet);
                        }
                        catch (error) {
                            Logger.log(`PS Packet Parse Fail.${error}`);
                        }
                    }
                }
                break;
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

                    if (elementary_stream_id == 0xc0)
                        streaminfo.audio = stream_type;

                    if (elementary_stream_id == 0xe0)
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
}

module.exports = NodeGB28181StreamServerSession;