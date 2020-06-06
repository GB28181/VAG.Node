const Net = require('net');
const Logger = require('./node_core_logger');
const NodeRtpSession = require('./node_GB28181Stream_session');
const context = require('./node_core_ctx');
const NodeRtmpClient = require('./node_rtmp_client');

const RtpSession = require("rtp-rtcp").RtpSession;
const RtpPacket = require("rtp-rtcp").RtpPacket;


//GB28181 媒体服务器
class NodeGB28181StreamServer {
    constructor(config) {
        //TCP
        this.tcpPort = config.GB28181.streamServer.tcpPort || 9100;
        this.tcpServer = Net.createServer((socket) => {
            let session = new NodeRtpSession(config, socket);
            session.run();
        });

        this.host = config.GB28181.streamServer.host || '0.0.0.0';
        //UDP
        this.udpPort = config.GB28181.streamServer.udpPort || 9200;

        this.udpServer = new RtpSession(this.udpPort);

        this.udpServer.createRtcpServer();

        //会话
        this.dialogs = {};

        //媒体发送者
        this.devices = {};

        this.rtpPackets = new Map();

        this.RtmpClients = {};

        //默认的RTMP服务器基地址
        this.rtmpServer = config.GB28181.streamServer.rtmpServer || 'rtmp://127.0.0.1/live';
    }

    run() {
        //TCP
        this.tcpServer.listen(this.tcpPort, () => {
            Logger.log(`Node Media GB28181-Stream/TCP Server started on port: ${this.tcpPort}`);
        });
        this.tcpServer.on('error', (e) => {
            Logger.error(`Node Media GB28181-Stream/TCP Server ${e}`);
        });
        this.tcpServer.on('close', () => {
            Logger.log('Node Media GB28181-Stream/TCP Server Close.');
        });

        //UDP
        this.udpServer.on("listening", () => {
            Logger.log(`Node Media GB28181-Stream/UDP Server started on port: ${this.udpPort}`);
        });

        this.udpServer.on("message", (msg, info) => {
            let rtpPacket = new RtpPacket(msg);

            let ssrc = rtpPacket.getSSRC();
            let seqNumber = rtpPacket.getSeqNumber();
            let playloadType = rtpPacket.getPayloadType();
            let timestamp = rtpPacket.getTimestamp();

            if (!this.rtpPackets.has(ssrc))
                this.rtpPackets.set(ssrc, new Map());

            let session = this.rtpPackets.get(ssrc);

            Logger.log(`RTP Packet: timestamp:${timestamp} seqNumber:${seqNumber}`);

            switch (playloadType) {
                //PS封装
                case 96:
                    {
                        //相同序号的分包数据,未考虑分包可能乱序的情况
                        session.set(seqNumber, rtpPacket.getPayload());

                        //缓存 100 帧
                        if (session.size > 100) {
                            let psdataCache = Buffer.alloc(0);

                            for (var key of session.keys()) {
                                psdataCache = Buffer.concat([psdataCache, session.get(key)]);
                                session.delete(key);
                            }

                            let indexs = [];
                            let psdatas = [];
                            let position = 0;

                            while (psdataCache.length - 4 > position) {
                                //0x000000BA
                                if (psdataCache.readUInt32BE(position) == 442) {
                                    indexs.push(position);
                                    position += 4;

                                    if (indexs.length > 1) {
                                        let psdata = psdataCache.slice(indexs[indexs.length - 2], indexs[indexs.length - 1]);
                                        psdatas.push(psdata);
                                    }
                                }

                                position++;
                            }

                            //最后一个位置后的数据无法判断PS包是否完整，塞回缓存
                            if (indexs.length > 0) {
                                let psdata = psdataCache.slice(indexs[indexs.length - 1]);
                                session.set(seqNumber, psdata);
                            }

                            psdatas.forEach((psdata) => {
                                try {
                                    let packet = NodeRtpSession.parseMpegPSPacket(psdata);

                                    if (packet.video.length > 0 )
                                        context.nodeEvent.emit('rtpReceived', this.PrefixInteger(ssrc, 10), timestamp, packet);
                                }
                                catch (error) {
                                    Logger.log(`PS Packet Parse Fail.${error}`);
                                }
                            })
                        }
                    }
                    break;
            }


        });

        //收到RTP 包
        context.nodeEvent.on('rtpReceived', this.rtpReceived.bind(this));

        //停止播放
        context.nodeEvent.on('stopPlayed', (ssrc) => {
            if (this.RtmpClients[ssrc]) {
                this.RtmpClients[ssrc].stop();
                delete this.RtmpClients[ssrc];
            }
        });
    }

    //补位0
    PrefixInteger(num, m) {
        return (Array(m).join(0) + num).slice(-m);
    }

    //TCPServer/UDPServer 接收到nalus
    rtpReceived(ssrc, timestamp, packet) {

        if (!this.RtmpClients[ssrc]) {
            this.RtmpClients[ssrc] = new NodeRtmpClient(`${this.rtmpServer}/${ssrc}`);
            this.RtmpClients[ssrc].startPush();

            //RTMP 发布流状态
            this.RtmpClients[ssrc].on('status', (info) => {
                if (info.code === 'NetStream.Publish.Start') {
                    this.RtmpClients[ssrc].isPublishStart = true;
                }
            });
        }

        //记录收包时间，长时间未收包关闭会话
        this.RtmpClients[ssrc]._lastReceiveTime = new Date();

        //发送视频第一包
        if (!this.RtmpClients[ssrc].sendfirstVideoPacket && this.RtmpClients[ssrc].isPublishStart) {

            let streaminfo = this.RtmpClients[ssrc]._streaminfo;

            switch (streaminfo.video) {
                case 36:
                    {
                        let vps = this.RtmpClients[ssrc]._vps;
                        let sps = this.RtmpClients[ssrc]._sps;
                        let pps = this.RtmpClients[ssrc]._pps;

                        if (vps && sps && pps) {
                            let _packet = Buffer.concat([Buffer.from([0x1C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x5A, 0xF0, 0x01, 0xFC, 0xFD, 0xF8, 0xF8, 0x00, 0x00, 0x0F, 0x03, 0x20, 0x00, 0x01, vps.length >> 8 & 0xff, vps.length & 0xff]), vps, Buffer.from([0x21, 0x00, 0x01, sps.length >> 8 & 0xff, sps.length & 0xff]), sps, Buffer.from([0x22, 0x00, 0x01, pps.length >> 8 & 0xff, pps.length & 0xff]), pps]);
                            this.RtmpClients[ssrc].pushVideo(_packet, 0);
                            this.RtmpClients[ssrc].delta = 0;
                            this.RtmpClients[ssrc].sendfirstVideoPacket = true;
                        }
                    }
                    break;
                case 27:
                    {
                        let sps = this.RtmpClients[ssrc]._sps;
                        let pps = this.RtmpClients[ssrc]._pps;

                        if (sps && pps) {
                            let _packet = Buffer.concat([Buffer.from([0x17, 0x00, 0x00, 0x00, 0x00, 0x01, sps.readUInt8(1), sps.readUInt8(2), sps.readUInt8(3), 0xff, 0xe1, sps.length >> 8 & 0xff, sps.length & 0xff]), sps, Buffer.from([0x01, pps.length >> 8 & 0xff, pps.length & 0xff]), pps]);
                            this.RtmpClients[ssrc].pushVideo(_packet, 0);
                            this.RtmpClients[ssrc].delta = 0;
                            this.RtmpClients[ssrc].sendfirstVideoPacket = true;
                        }
                    }
                    break;
            }
        }

        //判断packet.streaminfo H264/H265

        if (!this.RtmpClients[ssrc]._streaminfo && packet.streaminfo)
            this.RtmpClients[ssrc]._streaminfo = packet.streaminfo;

        if (!this.RtmpClients[ssrc]._streaminfo.video && packet.streaminfo.video)
            this.RtmpClients[ssrc]._streaminfo.video = packet.streaminfo.video;

        if (!this.RtmpClients[ssrc]._streaminfo.audio && packet.streaminfo.audio)
            this.RtmpClients[ssrc]._streaminfo.audio = packet.streaminfo.audio;

        //发送视频
        packet.video.forEach(nalu => {

            switch (this.RtmpClients[ssrc]._streaminfo.video) {
                //H265
                case 36:
                    {
                        let naluType = (nalu.readUInt8(0) & 0x7E) >> 1;

                        switch (naluType) {
                            case 19:
                                this.RtmpClients[ssrc]._keyframe = nalu;
                                break;
                            case 32:
                                if (!this.RtmpClients[ssrc]._vps)
                                    this.RtmpClients[ssrc]._vps = nalu;
                                break;
                            case 33:
                                if (!this.RtmpClients[ssrc]._sps)
                                    this.RtmpClients[ssrc]._sps = nalu;
                                break;
                            case 34:
                                if (!this.RtmpClients[ssrc]._pps)
                                    this.RtmpClients[ssrc]._pps = nalu;
                                break;
                        }

                        //flv封装
                        if (naluType !== 32 && naluType !== 33 && naluType !== 34) {

                            let packet = Buffer.concat([Buffer.from([naluType == 19 ? 0x1C : 0x2C, 0x01, 0x00, 0x00, 0x00, (nalu.length >> 24 & 0xff), (nalu.length >> 16 & 0xff), (nalu.length >> 8 & 0xff), (nalu.length & 0xff)]), nalu]);

                            this.RtmpClients[ssrc].delta += 40;

                            if (this.RtmpClients[ssrc].isPublishStart && this.RtmpClients[ssrc].sendfirstVideoPacket)
                                this.RtmpClients[ssrc].pushVideo(packet, this.RtmpClients[ssrc].delta);
                        }
                    }
                    break;
                //H264
                case 27:
                    {
                        let naluType = nalu.readUInt8(0) & 0x1F;

                        switch (naluType) {
                            case 5:
                                this.RtmpClients[ssrc]._keyframe = nalu;
                                break;
                            case 7:
                                if (!this.RtmpClients[ssrc]._sps)
                                    this.RtmpClients[ssrc]._sps = nalu;
                                break;
                            case 8:
                                if (!this.RtmpClients[ssrc]._pps)
                                    this.RtmpClients[ssrc]._pps = nalu;
                                break;
                        }

                        //flv封装
                        if (naluType !== 7 && naluType !== 8) {

                            let packet = Buffer.concat([Buffer.from([naluType == 5 ? 0x17 : 0x27, 0x01, 0x00, 0x00, 0x00, (nalu.length >> 24 & 0xff), (nalu.length >> 16 & 0xff), (nalu.length >> 8 & 0xff), (nalu.length & 0xff)]), nalu]);

                            this.RtmpClients[ssrc].delta += 40;

                            if (this.RtmpClients[ssrc].isPublishStart && this.RtmpClients[ssrc].sendfirstVideoPacket)
                                this.RtmpClients[ssrc].pushVideo(packet, this.RtmpClients[ssrc].delta);
                        }
                    }
                    break;
            }
        });

        //发送音频
        if (packet.audio.length > 0) {
            if (this.RtmpClients[ssrc].isPublishStart && this.RtmpClients[ssrc].sendfirstAudioPacket) {
                this.RtmpClients[ssrc].pushAudio(packet.audio, timestamp);
            }
        }
    }

    stop() {

        this.uac.destroy();

        this.tcpServer.close();

        this.udpServer.close();

        context.sessions.forEach((session, id) => {
            if (session instanceof NodeRtpSession) {
                session.socket.destroy();
                context.sessions.delete(id);
            }
        });
    }
}

module.exports = NodeGB28181StreamServer