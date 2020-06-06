const dgram = require('dgram');
const Net = require('net');
const sip = require('sip');
const sdp = require('sdp-transform');

const Logger = require('./node_core_logger');
const NodeRtpSession = require('./node_GB28181Stream_session');
const context = require('./node_core_ctx');
const NodeRtmpClient = require('./node_rtmp_client');

const RtpSession = require("rtp-rtcp").RtpSession;
const RtpPacket = require("rtp-rtcp").RtpPacket;


//GB28181 媒体服务器
class NodeGB28181StreamServer {
    constructor(config) {

        //SIP 通信端口
        this.port = config.GB28181.streamServer.sipPort || 5062;
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
        this.seqNumbers = {};

        this.RtmpClients = {};
        //RTMP服务器地址
        this.rtmpServer = config.GB28181.streamServer.rtmpServer || 'rtmp://127.0.0.1/live';
    }

    run() {
        //SIP Session 收到消息
        this.uac = sip.create({ port: this.port, logger: Logger }, (request) => {

            switch (request.method) {
                //收到 Uas SIP服务器 invite
                case 'INVITE':

                    //判断UAS
                    let uas = sip.parseUri(request.headers.from.uri);
                    if (uas) {
                        let deviceid = uas.user;//SIP 服务器国标编码

                        //subject 媒体流发送者设备编码:发送方媒体序列号，媒体流接收者设备编码:接收端媒体流序列号
                        let ssrc = '';
                        let subjects = request.subject.split(',');
                        if (subjects.length > 0) {
                            let params = subjects[0].split(':');
                            deviceid = params[0];
                            ssrc = params[1];
                        }

                        //判断是否带SDP
                        //Step 8 完成三方呼叫控制后，SIP 服务器通过B2BUA代理方式建立媒体流接收者和媒体服务器之间的媒体连接，在消息1中增加ssrc值，转发给媒体服务器
                        if (request.content) {
                            let res = sdp.parse(request.content);
                            //Step 9 媒体服务器收到invite请求，回复200 OK响应，携带SDP消息体
                            let content = `v=0\r\n` +
                                `o=${res.origin.username} 0 0 IN IP4 ${this.host}\r\n` +
                                `s=NodeMediaServer-GB28181\r\n` +
                                `c=IN IP4 ${this.host}\r\n` +
                                `t=0 0\r\n` +
                                `m=video ${this.udpPort} RTP/AVP 96 98 97\r\n` +
                                `m=video ${this.tcpPort} TCP/RTP/AVP 96 98 97\r\n` +
                                `a=recvonly\r\n` +
                                `a=rtpmap:96 PS/90000\r\n` +
                                `a=rtpmap:97 MPEG4/90000\r\n` +
                                `a=rtpmap:98 H264/90000\r\n` +
                                `y=${res.y}`;

                            let rs = sip.makeResponse(request, 200, 'OK', {
                                headers: { 'content-type': 'Application/sdp' },
                                content: content
                            });
                            rs.headers.to.params.tag = NodeSipSession.tagRandom(8);
                            this.uac.send(rs);

                            let session_8_9_12 = [request.headers['call-id'], request.headers.from.params.tag, rs.headers.to.params.tag].join(':');
                            if (!this.dialogs[session_8_9_12]) {
                                this.dialogs[session_8_9_12] = function (rq) {
                                    //Step 12 转发 消息11 给媒体服务器，完成与媒体服务器的invite会话建立过程
                                    if (rq.method === 'ACK') {
                                        //向媒体流接收者发送数据

                                    }

                                    //Step 15 向媒体服务器发送 BYE 消息，断开消息8，9，12建立的invite会话
                                    if (rq.method === 'BYE') {
                                        delete this.dialogs[session_8_9_12];
                                        //停止发送数据
                                    }
                                }
                            }
                        }
                        else {
                            if (!this.devices[deviceid]) {

                                let rtmpclient = new NodeRtmpClient(`${this.rtmpServer}/${deviceid}`);
                                rtmpclient.startPush();

                                //RTMP publish start
                                rtmpclient.on('status', (info) => {
                                    if (info.code === 'NetStream.Publish.Start') {
                                        rtmpclient.isPublishStart = true;
                                    }
                                });

                                //RTMP连接关闭
                                rtmpclient.on('close', () => {
                                    //重连？或发 bye 
                                });

                                //收到媒体发送者 TCP/UDP 发送的数据
                                this.devices[deviceid] = function (data, type) {
                                    //往RTMP流服务器推送
                                    if (rtmpclient.isPublishStart) {
                                        switch (type) {
                                            case 'audio':
                                                rtmpclient.writeAudioFrame(data);
                                                break;
                                            case 'video':
                                                rtmpclient.writeVideoFrame(data);
                                                break;
                                        }
                                    }
                                }

                                //Step 2 SIP invite
                                let sdp = `v=0\r\n` +
                                    `o=${deviceid} 0 0 IN IP4 ${this.host}\r\n` +
                                    `s=NodeMediaServer-GB28181\r\n` +
                                    `c=IN IP4 ${this.host}\r\n` +
                                    `t=0 0\r\n` +
                                    `m=video ${this.udpPort} RTP/AVP 96 98 97\r\n` +
                                    `m=video ${this.tcpPort} TCP/RTP/AVP 96 98 97\r\n` +
                                    `a=recvonly\r\n` +
                                    `a=rtpmap:96 PS/90000\r\n` +
                                    `a=rtpmap:97 MPEG4/90000\r\n` +
                                    `a=rtpmap:98 H264/90000\r\n`;

                                //Step 3 媒体服务器收到SIP服务器invite请求后，回复200 OK响应，携带SDP消息体，消息体中描述了媒体服务器接收媒体流的IP，端口，媒体格式等内容
                                let rs = sip.makeResponse(request, 200, 'OK', {
                                    headers: { 'content-type': 'Application/sdp' },
                                    content: sdp
                                });

                                rs.headers.to.params.tag = NodeSipSession.tagRandom(8);
                                this.uac.send(rs);

                                //记录会话标识
                                let session_2_3_6 = [request.headers['call-id'], request.headers.from.params.tag, rs.headers.to.params.tag].join(':');

                                if (!this.dialogs[session_2_3_6]) {
                                    this.dialogs[session_2_3_6] = function (rq) {
                                        //Step 6 SIP服务器收到媒体流发送者返回的200OK响应后，向媒体服务器发送 ACK请求，请求中携带 消息5中媒体流发送者回复的200 ok响应消息体，完成与媒体服务器的invite会话建立过程
                                        if (rq.method === 'ACK') {
                                            //ACK 媒体发送者SDP 相关信息，开始接收媒体流发送者 推流                                        

                                            //关联deviceid-ssrc                                           
                                        }

                                        //Step 17 SIP服务器向媒体服务器发送BYE消息
                                        if (rq.method === 'BYE') {
                                            delete this.dialogs[session_2_3_6];
                                            //停止接收数据
                                            delete this.devices[deviceid];
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // this.uac.send(sip.makeResponse(request, 100, 'Trying'));

                    break;
                case 'ACK':
                case 'BYE':
                    try {
                        let callid = [request.headers['call-id'], request.from.params.tag, request.headers.to.params.tag].join(':');
                        if (this.dialogs[callid]) {
                            this.dialogs[callid](request);
                        } else {
                            this.uas.send(sip.makeResponse(request, 481, "Call doesn't exists"));
                        }
                    }
                    catch (e) {
                        this.uac.send(sip.makeResponse(request, 405, 'Method not allowed'));
                    }
                    break;
                default:
                    this.uac.send(sip.makeResponse(request, 405, 'Method not allowed'));
                    break;
            }
        });

        Logger.log(`Node Media GB28181-Stream/SIP Client started on port: ${this.port}`);

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