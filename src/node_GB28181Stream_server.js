const Net = require('net');
const Logger = require('./node_core_logger');
const NodeRtpSession = require('./node_GB28181Stream_session');
const context = require('./node_core_ctx');
const NodeRtmpClient = require('./node_rtmp_client');
const RtpSession = require("rtp-rtcp").RtpSession;

//GB28181 媒体服务器
class NodeGB28181StreamServer {
    constructor(config) {
        this.listen = config.GB28181.streamServer.listen || 9200;
        this.host = config.GB28181.streamServer.host || '0.0.0.0';

        //开启端口复用
        if (config.GB28181.streamServer.invite_port_fixed) {
            //RTP-RTCP
            this.udpServer = new RtpSession(this.listen);
            this.udpServer.createRtcpServer();

            this.tcpServer = Net.createServer((socket) => {
                let session = new NodeRtpSession(config, socket);
                session.run();
            });
        }

        //主动取流客户端（TCP/主动模式）
        this.tcpClients = {};

        //推流客户端
        this.rtmpClients = {};

        //默认的RTMP服务器基地址
        this.rtmpServer = config.GB28181.streamServer.rtmpServer || 'rtmp://127.0.0.1/live';
    }

    run() {

        if (this.udpServer) {
            //TCP
            this.tcpServer.listen(this.listen, () => {
                Logger.log(`Node Media GB28181-Stream/TCP Server started on port: ${this.listen}`);
            });
            this.tcpServer.on('error', (e) => {
                Logger.error(`Node Media GB28181-Stream/TCP Server ${e}`);
            });
            this.tcpServer.on('close', () => {
                Logger.log('Node Media GB28181-Stream/TCP Server Close.');
            });
        }

        if (this.udpServer) {
            //UDP
            this.udpServer.on("listening", () => {
                Logger.log(`Node Media GB28181-Stream/UDP Server started on port: ${this.listen}`);
            });

            this.udpServer.on("message", (msg, info) => {
                NodeRtpSession.parseRTPacket(msg);
            });
        }

        //创建TCP 主动连接客户端
        context.nodeEvent.on('sdpReceived', this.sdpReceived.bind(this));

        //RTP己处理好
        context.nodeEvent.on('rtpReadyed', this.rtpReceived.bind(this));

        //停止播放,关闭推流客户端
        context.nodeEvent.on('stopPlayed', (ssrc) => {
            if (this.rtmpClients[ssrc]) {
                this.rtmpClients[ssrc].stop();
                delete this.rtmpClients[ssrc];
            }
        });
    }

    //接收到 INVITE SDP 描述
    sdpReceived(sdpContent) {
        
        //判断流发送者SDP描述，如果是 TCP主动模式 则创建主动取流客户端
        if (sdpContent.media.length > 0 && sdpContent.media[0].setup === "passive") {
            let host = sdpContent.connection.ip;
            let port = sdpContent.media[0].port;
            
            
        }
    }

    //创建TCP主动取流客户端
    createTCPClient(ssrc, host, port) {

        if (!this.tcpClients[ssrc]) {

            this.tcpClients[ssrc] = new Net.Socket();

            this.tcpClients[ssrc].connect(port, host, () => { Logger.log("TCP Client 连接成功，等待接收 RTP 数据包...") });

            this.tcpClients[ssrc].on('data', (data) => {
                NodeRtpSession.parseTCPRTPacket(ssrc, data);
            });

            //连接关闭
            this.tcpClients[ssrc].on('error', (err) => {
                this.tcpClients[ssrc].destroy();
                delete this.this.tcpClients[ssrc];
            });
        }
    }

    //TCPServer/UDPServer 接收到nalus
    rtpReceived(ssrc, timestamp, packet) {

        if (!this.rtmpClients[ssrc]) {
            this.rtmpClients[ssrc] = new NodeRtmpClient(`${this.rtmpServer}/${ssrc}`);
            this.rtmpClients[ssrc].startPush();

            //RTMP 发布流状态
            this.rtmpClients[ssrc].on('status', (info) => {
                if (info.code === 'NetStream.Publish.Start')
                    this.rtmpClients[ssrc].isPublishStart = true;
            });

            //连接关闭
            this.rtmpClients[ssrc].on('close', () => {
                context.nodeEvent.emit('rtmpClientClose', ssrc);
            });
        }

        let rtmpClinet = this.rtmpClients[ssrc];

        //记录收包时间，长时间未收包关闭会话
        rtmpClinet._lastReceiveTime = new Date();

        //发送视频第一包
        if (!rtmpClinet.sendfirstVideoPacket && rtmpClinet.isPublishStart) {

            let streaminfo = rtmpClinet._streaminfo;

            switch (streaminfo.video) {
                case 0x24:
                    {
                        let vps = rtmpClinet._vps;
                        let sps = rtmpClinet._sps;
                        let pps = rtmpClinet._pps;

                        if (vps && sps && pps) {
                            let _packet = Buffer.concat([Buffer.from([0x1C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x5A, 0xF0, 0x01, 0xFC, 0xFD, 0xF8, 0xF8, 0x00, 0x00, 0x0F, 0x03, 0x20, 0x00, 0x01, vps.length >> 8 & 0xff, vps.length & 0xff]), vps, Buffer.from([0x21, 0x00, 0x01, sps.length >> 8 & 0xff, sps.length & 0xff]), sps, Buffer.from([0x22, 0x00, 0x01, pps.length >> 8 & 0xff, pps.length & 0xff]), pps]);
                            rtmpClinet.pushVideo(_packet, 0);
                            rtmpClinet.deltaVideo = 0;
                            rtmpClinet.sendfirstVideoPacket = true;
                        }
                    }
                    break;
                case 0x1b:
                    {
                        let sps = rtmpClinet._sps;
                        let pps = rtmpClinet._pps;

                        if (sps && pps) {
                            let _packet = Buffer.concat([Buffer.from([0x17, 0x00, 0x00, 0x00, 0x00, 0x01, sps.readUInt8(1), sps.readUInt8(2), sps.readUInt8(3), 0xff, 0xe1, sps.length >> 8 & 0xff, sps.length & 0xff]), sps, Buffer.from([0x01, pps.length >> 8 & 0xff, pps.length & 0xff]), pps]);
                            rtmpClinet.pushVideo(_packet, 0);
                            rtmpClinet.deltaVideo = 0;
                            rtmpClinet.sendfirstVideoPacket = true;
                        }
                    }
                    break;
            }
        }

        //发送音频第一包
        if (!rtmpClinet.sendfirstAudioPacket && rtmpClinet.isPublishStart) {

            let streaminfo = rtmpClinet._streaminfo;

            switch (streaminfo.audio) {
                //AAC
                case 0x0f:
                    break;
                //SVAC
                case 0x9b:
                    break;
                //PCM
                case 0x8b:
                    break;
                //G711a
                case 0x90:
                    {
                        var _packet = Buffer.from([0x70]);
                        rtmpClinet.pushAudio(_packet, 0);
                        rtmpClinet.deltaAudio = 0;
                        rtmpClinet.sendfirstAudioPacket = true;
                    }
                    break;
                //G711u
                case 0x91:
                    {
                        var _packet = Buffer.from([0x80]);
                        rtmpClinet.pushAudio(_packet, 0);
                        rtmpClinet.deltaAudio = 0;
                        rtmpClinet.sendfirstAudioPacket = true;
                    }
                    break;
                //G722
                case 0x92:
                    break;
                //G723
                case 0x93:
                    break;
                //G729
                case 0x99:
                    break;
            }
        }

        //判断packet.streaminfo H264/H265

        if (!rtmpClinet._streaminfo && packet.streaminfo)
            rtmpClinet._streaminfo = packet.streaminfo;

        if (!rtmpClinet._streaminfo.video && packet.streaminfo.video)
            rtmpClinet._streaminfo.video = packet.streaminfo.video;

        if (!rtmpClinet._streaminfo.audio && packet.streaminfo.audio)
            rtmpClinet._streaminfo.audio = packet.streaminfo.audio;

        //发送视频
        packet.video.forEach(nalu => {

            switch (rtmpClinet._streaminfo.video) {
                //H265
                case 0x24:
                    {
                        let naluType = (nalu.readUInt8(0) & 0x7E) >> 1;

                        switch (naluType) {
                            case 19:
                                rtmpClinet._keyframe = nalu;
                                break;
                            case 32:
                                if (!rtmpClinet._vps)
                                    rtmpClinet._vps = nalu;
                                break;
                            case 33:
                                if (!rtmpClinet._sps)
                                    rtmpClinet._sps = nalu;
                                break;
                            case 34:
                                if (!rtmpClinet._pps)
                                    rtmpClinet._pps = nalu;
                                break;
                        }

                        //flv封装
                        if (naluType !== 32 && naluType !== 33 && naluType !== 34) {

                            let packet = Buffer.concat([Buffer.from([naluType == 19 ? 0x1C : 0x2C, 0x01, 0x00, 0x00, 0x00, (nalu.length >> 24 & 0xff), (nalu.length >> 16 & 0xff), (nalu.length >> 8 & 0xff), (nalu.length & 0xff)]), nalu]);

                            rtmpClinet.deltaVideo += timestamp / 90;

                            if (rtmpClinet.isPublishStart && rtmpClinet.sendfirstVideoPacket)
                                rtmpClinet.pushVideo(packet, rtmpClinet.deltaVideo);
                        }
                    }
                    break;
                //H264
                case 0x1b:
                    {
                        let naluType = nalu.readUInt8(0) & 0x1F;

                        switch (naluType) {
                            case 5:
                                rtmpClinet._keyframe = nalu;
                                break;
                            case 7:
                                if (!rtmpClinet._sps)
                                    rtmpClinet._sps = nalu;
                                break;
                            case 8:
                                if (!rtmpClinet._pps)
                                    rtmpClinet._pps = nalu;
                                break;
                        }

                        //flv封装
                        if (naluType !== 7 && naluType !== 8) {

                            let packet = Buffer.concat([Buffer.from([naluType == 5 ? 0x17 : 0x27, 0x01, 0x00, 0x00, 0x00, (nalu.length >> 24 & 0xff), (nalu.length >> 16 & 0xff), (nalu.length >> 8 & 0xff), (nalu.length & 0xff)]), nalu]);

                            rtmpClinet.deltaVideo += timestamp / 90;

                            if (rtmpClinet.isPublishStart && rtmpClinet.sendfirstVideoPacket)
                                rtmpClinet.pushVideo(packet, rtmpClinet.deltaVideo);
                        }
                    }
                    break;
                //SVAC
                case 0x80:
                    break;
            }
        });

        //发送音频
        if (packet.audio.length > 0) {
            if (rtmpClinet.isPublishStart && rtmpClinet.sendfirstAudioPacket) {

                switch (rtmpClinet._streaminfo.audio) {
                    //G711a
                    case 0x90:
                        {
                            rtmpClinet.deltaAudio += (packet.audio.length / 8000) * 1000;
                            rtmpClinet.pushAudio(Buffer.concat([Buffer.from([0x70]), packet.audio]), rtmpClinet.deltaAudio);
                        }
                        break;
                    //G711u
                    case 0x91:
                        {
                            rtmpClinet.deltaAudio += (packet.audio.length / 8000) * 1000;
                            rtmpClinet.pushAudio(Buffer.concat([Buffer.from([0x80]), packet.audio]), rtmpClinet.deltaAudio);
                        }
                        break;
                }
            }
        }
    }

    stop() {

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