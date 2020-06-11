const xml2js = require('xml2js');
const os = require('os');
const sip = require('sip');
const sdp = require('sdp-transform');
const Logger = require('./node_core_logger');
const context = require('./node_core_ctx');

class NodeSipSession {
    constructor(config, session, userid, via, contact, uas) {

        this.config = config;
        this.session = session;
        this.id = userid;
        this.via = via;
        this.contact = contact;
        this.sn = 0;
        this.callbacks = {};
        this.dialogs = {};

        //超时
        this.pingTime = config.GB28181.sipServer.ping ? config.GB28181.sipServer.ping * 1000 : 60000;

        //重试次数
        this.pingTimeout = config.GB28181.sipServer.ping_timeout || 3;

        //最后一个保活包接收时间
        this.startTimestamp = Date.now();
        //丢包统计，连接3次丢包，表示对象下线
        this.lostPacketCount = 0;

        this.pingInterval = null;

        this.uas = uas;

        this.TAG = 'sip';

        context.sessions.set(this.id, this);
    }

    //启动
    async run() {

        this.pingInterval = setInterval(() => {

            let timevalue = Date.now() - this.startTimestamp;

            if (timevalue > this.pingTime) {
                this.lostPacketCount++;

                if (this.lostPacketCount > this.pingTimeout) {
                    this.stop();

                    context.nodeEvent.emit('offline', this.id);
                }
            }
        }, this.pingTime);

        this.isStarting = true;
        Logger.log(`[${this.TAG} connect] id=${this.id} ip=${this.via.host} port=${this.via.port} `);

        context.nodeEvent.emit('online', this.id);

        //设备基本信息
        this.deviceinfo = await this.getDeviceInfo();
        //设备状态
        this.devicestatus = await this.getDeviceStatus();
        //目录查询
        this.catalog = await this.getCatalog();
    }

    // 停止
    stop() {
        if (this.isStarting) {

            if (this.pingInterval != null) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }

            this.isStarting = false;
            context.sessions.delete(this.id);
            delete this.session;
        }
    }

    //将XML转JSON
    parseXml(xml) {
        let json = {};
        xml2js.parseString(xml, { explicitArray: false, ignoreAttrs: true }, (err, result) => {
            json = result;
        });
        return json;
    }

    //云台控制
    async PTZ(channelid, ptzvalue) {
        return await this.ControlPTZ(channelid, ptzvalue);
    }

    //设备重启
    async reBoot() {
        return await this.ControlBoot();
    }

    //获取设备基础信息
    async getDeviceInfo() {
        return await this.QueryDeviceInfo();
    }

    //获取设备目录
    async getCatalog() {
        return await this.QueryDeviceCatalog();
    }

    //获取设备状态信息
    async getDeviceStatus() {
        return await this.QueryDeviceStatus();
    }

    //云台控制
    ControlPTZ(channelid, ptzvalue) {
        return new Promise((resolve, reject) => {
            let result = {};
            this.Control(channelid, 'PTZCmd', ptzvalue, content => {
                if (content.Result === 'OK') {
                    switch (content.CmdType) {
                        case 'DeviceControl':
                            result = { result: true, message: content.Result };
                            break;
                    }
                }
                else {
                    result = { result: false, message: content.Result, errorcode: content.ErrorCode };
                }
                resolve(result);
            });
        });
    }

    //重启
    ControlBoot() {
        return new Promise((resolve, reject) => {
            let result = {};
            this.Control(this.id, 'TeleBoot', 'Boot', (content) => {
                if (content.Result === 'OK') {
                    switch (content.CmdType) {
                        case 'DeviceControl':
                            result = { result: true, message: content.Result };
                            break;
                    }
                }
                else {
                    result = { result: false, message: content.Result, errorcode: content.ErrorCode };
                }
                resolve(result);
            });
        });
    }

    //设备信息
    QueryDeviceInfo() {
        return new Promise((resolve, reject) => {
            let deviceinfo = {};
            this.Query('DeviceInfo', (content) => {
                if (content.Result === 'OK') {
                    switch (content.CmdType) {
                        case 'DeviceInfo':
                            deviceinfo = { manufacturer: content.Manufacturer, model: content.Model, firmware: content.Firmware, name: content.DeviceName };
                            break;
                    }
                }
                else {
                    deviceinfo = { result: false, message: content.Result, errorcode: content.ErrorCode };
                }
                resolve(deviceinfo)
            });

        })
    }

    //设备目录
    QueryDeviceCatalog() {
        return new Promise((resolve, reject) => {
            let catalog = {};
            this.Query('Catalog', (content) => {
                if (content.Result) {
                    catalog = { result: false, message: content.Result, errorcode: content.ErrorCode };
                }
                else {
                    switch (content.CmdType) {
                        case 'Catalog':
                            catalog = { sumNum: content.SumNum, devicelist: content.DeviceList };
                            break;
                    }
                }
                resolve(catalog);
            });
        });
    }

    //设备状态
    QueryDeviceStatus() {
        return new Promise((resolve, reject) => {
            let devicestatus = {};
            this.Query('DeviceStatus', (content) => {
                if (content.Result === 'OK') {
                    switch (content.CmdType) {
                        case 'DeviceStatus'://设备状态
                            devicestatus = { online: content.Online, status: content.Status, encode: content.Encode, record: content.Record, devicetime: content.DeviceTime };
                            break;
                    }
                }
                else {
                    devicestatus = { result: false, message: content.Result, errorcode: content.ErrorCode };
                }
                resolve(devicestatus);
            });
        });
    }

    //控制 channelid 设备通道国标编码
    Control(channelid, cmdtype, cmdvalue, callback) {
        //PTZCmd/TeleBoot
        let json = {
            Query: {
                CmdType: 'DeviceControl',
                SN: this.sn++,
                DeviceID: channelid
            }
        };

        switch (cmdtype) {
            case 'PTZCmd':
                json.Query.PTZCmd = cmdvalue;
                break;
            case 'TeleBoot':
                json.Query.TeleBoot = cmdvalue;
                break;
        }

        let id = [json.Query.CmdType, json.Query.SN].join(':');

        if (!this.callbacks[id])
            this.callbacks[id] = callback;

        //JSON 转XML
        let builder = new xml2js.Builder();
        let content = builder.buildObject(json);

        let options = {
            method: 'MESSAGE',
            contentType: 'Application/MANSCDP+xml',
            content: content
        };

        this.send(options);
    }

    //查询
    Query(cmdtype, callback) {
        //DeviceInfo/Catalog/DeviceStatus
        let json = {
            Query: {
                CmdType: cmdtype,
                SN: this.sn++,
                DeviceID: this.id
            }
        };

        let id = [json.Query.CmdType, json.Query.SN].join(':');

        if (!this.callbacks[id])
            this.callbacks[id] = callback;

        //JSON 转XML
        let builder = new xml2js.Builder();
        let content = builder.buildObject(json);

        let options = {
            method: 'MESSAGE',
            contentType: 'Application/MANSCDP+xml',
            content: content
        };

        this.send(options);
    }

    //下载
    Download() {

    }

    //回放 begin-开始时间 end-结束时间 channelid-设备通道国标编码
    Playback(begin, end, channelid) {
        let ssid = channelid.substring(16, 20);
        let sirialid = channelid.substring(3, 8);
        let ssrc = "1" + sirialid + ssid;
        let host = this.config.rtp.host || "127.0.0.1";
        let port = this.config.rtp.udp || 9200;

        let content = `v=0\r\n` +
            `o=${this.id} 0 0 IN IP4 ${host}\r\n` +
            `s=Playback\r\n` +
            `c=IN IP4 ${host}\r\n` +
            `u=${channelid}:3` +
            `t=${begin} ${end}\r\n` +
            `m=video ${port} RTP/AVP 96 \r\n` +
            `a=rtpmap:96 PS/90000\r\n` +
            `a=recvonly\r\n` +
            `y=${ssrc}\r\n`;

        let options = {
            method: 'INVITE',
            contentType: 'Application/sdp',
            content: content
        };

        this.send(options);
    }


    //预览 channelid 通道国标编码
    RealPlay(channelid, rhost, rport, mode) {

        //0: udp,1:tcp/passive ,2:tcp/active
        let selectMode = mode || 0;
        let ssrc = "0" + channelid.substring(16, 20) + channelid.substring(3, 8);

        let host = rhost || "127.0.0.1";
        let port = rport || 9200;

        let isExist = false;

        for (var key in this.dialogs) {
            let session = this.dialogs[key];
            if (session.request && session.port === rport && session.host === rhost && session.channelid === channelid)
                isExist = true;
        }

        //己存在会话
        if (isExist)
            return;


        let sdpV = "";

        switch (selectMode) {
            case 0:
                break;
            case 1:
                sdpV = `a=setup:passive\r\n` +
                    `a=connection:new\r\n`;
                break;
            case 2:
                sdpV = `a=setup:active\r\n` +
                    `a=connection:new\r\n`;
                break;
        }

        //s=Play/Playback/Download/Talk
        let content = `v=0\r\n` +
            `o=${channelid} 0 0 IN IP4 ${host}\r\n` +
            `s=Play\r\n` +
            `c=IN IP4 ${host}\r\n` +
            `t=0 0\r\n` +
            `m=video ${port} TCP/RTP/AVP 96\r\n` +
            `a=rtpmap:96 PS/90000\r\n` +
            `a=recvonly\r\n` +
            sdpV +
            `y=${ssrc}\r\n`;


        let that = this;

        let options = {
            method: 'INVITE',
            contentType: 'Application/sdp',
            content: content,
            callback: function (response) {
                if (response.status >= 300) {
                    //错误信息
                    Logger.error(`[${that.TAG}] id=${that.id} ssrc=${ssrc} status=${response.status}`);
                }
                else if (response.status < 200) {
                    Logger.log(`[${that.TAG}] id=${that.id} ssrc=${ssrc} status=${response.status}`);
                }
                else {
                    //判断消息类型
                    switch (options.method) {
                        case 'INVITE':

                            //SDP
                            if (response.content) {

                                // 响应消息体
                                let sdpContent = sdp.parse(response.content);                               

                                //Step 6 SIP服务器收到媒体流发送者返回的200OK响应后，向 媒体服务器 发送 ACK请求，请求中携带 消息5中媒体流发送者回复的200 ok响应消息体，完成与媒体服务器的invite会话建立过程
                                context.nodeEvent.emit('sdpReceived', sdpContent);
                                
                                //Step 7 SIP服务器收到媒体流发送者返回200 OK响应后，向 媒体流发送者 发送 ACK请求，请求中不携带消息体，完成与媒体流发送者的invite会话建立过程
                                that.uas.send({
                                    method: 'ACK',
                                    uri: response.headers.contact[0].uri,
                                    headers: {
                                        to: response.headers.to,
                                        from: response.headers.from,
                                        'call-id': response.headers['call-id'],
                                        cseq: { method: 'ACK', seq: response.headers.cseq.seq }
                                    }
                                });

                                //会话标识
                                let key = [response.headers['call-id'], response.headers.from.params.tag, response.headers.to.params.tag].join(':');

                                //创建会话
                                if (!that.dialogs[key]) {
                                    // 断开会话请求
                                    let request = {
                                        method: 'BYE',
                                        uri: response.headers.contact[0].uri,
                                        headers: {
                                            to: response.headers.to,
                                            from: response.headers.from,
                                            'call-id': response.headers['call-id'],
                                            cseq: { method: 'BYE', seq: response.headers.cseq.seq + 1 }//需额外加1
                                        }
                                    }

                                    that.dialogs[key] = { channelid: channelid, ssrc: ssrc, host: host, port: port, request: request };
                                }
                            }
                            break;
                    }
                }
            }
        };

        this.send(options);
    }

    //停止实时预览
    StopRealPlay(channelid, rhost, rport) {
        for (var key in this.dialogs) {
            //搜索满足条件的会话
            let session = this.dialogs[key];
            if (session.request && session.port === rport && session.host === rhost && session.channelid === channelid) {
                this.uas.send(session.request, (reqponse) => {
                    //判断媒体发送者回复,断开RTMP推流
                    if (reqponse.status == 200) {
                        context.nodeEvent.emit('stopPlayed', session.ssrc);
                        delete this.dialogs[key];
                    }
                });
            }
        }
    }

    //处理 MESSAGE 
    onMessage(request) {
        let via = request.headers.via[0];
        let content = this.parseXml(request.content);
        //网络信息
        this.via = via;
        this.contact = request.headers.contact;

        // 回复
        if (content.hasOwnProperty('Response')) {
            let id = [content.Response.CmdType, content.Response.SN].join(':');
            if (this.callbacks[id]) {
                this.callbacks[id](content.Response);
                delete this.callbacks[id];
            }
        }

        // 通知
        if (content.hasOwnProperty('Notify')) {
            Logger.log(`[${this.id}] Notify,CmdType=${content.Notify.CmdType}`);
            switch (content.Notify.CmdType) {
                //保活消息
                case 'Keepalive':
                    //更新时间
                    this.startTimestamp = Date.now();
                    this.lostPacketCount = 0;
                    break;
            }
        }

        this.uas.send(sip.makeResponse(request, 200, 'Ok'));
    }

    //发送SIP消息
    send(options) {
        //设备国标编码+设备主机地址+通讯端口
        let uri = 'sip:' + this.id + '@' + this.via.host + ':' + this.via.port;

        let request = {
            method: options.method,
            uri: uri,
            headers: {
                to: { uri: 'sip:' + this.id + '@' + this.config.GB28181.sipServer.realm },
                from: { uri: 'sip:' + this.config.GB28181.sipServer.serial + '@' + this.config.GB28181.sipServer.realm, params: { tag: options.tag || this.getTagRandom(8) } },
                'call-id': this.getCallId(),
                cseq: { method: options.method, seq: Math.floor(Math.random() * 1e5) },
                'content-type': options.contentType,
                subject: options.subject,
                contact: [{ uri: 'sip:' + this.config.GB28181.sipServer.serial + '@' + os.hostname() + ":" + this.config.GB28181.sipServer.listen }]
            },
            content: options.content
        }

        this.uas.send(request, options.callback);
    }

    //
    getCallId() {
        return Math.floor(Math.random() * 1e6).toString() + '@' + this.config.GB28181.sipServer.mapHost || "127.0.0.1";
    }

    //
    getTagRandom(size) {
        let seed = new Array('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'm', 'n', 'p', 'Q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
            '2', '3', '4', '5', '6', '7', '8', '9'
        );//数组
        let seedlength = seed.length;//数组长度
        let num = '';
        for (let i = 0; i < size; i++) {
            let j = Math.floor(Math.random() * seedlength);
            num += seed[j];
        }
        return num;
    }
}

module.exports = NodeSipSession;