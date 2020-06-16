const xml2js = require('xml2js');
const OS = require('os');
const SIP = require('./sip/sip');
const SDP = require('./sdp/parser');
const Logger = require('./node_core_logger');
const context = require('./node_core_ctx');

class NodeSipSession {
    constructor(config, session, userid, via, contact, uas) {

        this.session = session;
        this.id = userid;
        this.via = via;
        this.contact = contact;
        this.sn = 0;
        this.callbacks = {};
        this.dialogs = {};

        //当前域
        this.GBDomain = config.GB28181.sipServer.realm || '3402000000';

        //SIP服务通讯端口
        this.GBServerPort = config.GB28181.sipServer.mapPort || config.GB28181.sipServer.listen;

        //SIP服务主机地址
        this.GBserverHost = config.GB28181.sipServer.mapHost || config.GB28181.sipServer.host;

        //SIP服务编号
        this.GBServerId = config.GB28181.sipServer.serial || config.GB28181.streamServer.serial;

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

        Logger.log(`[${this.id}] New Device Connected ip=${this.via.host} port=${this.via.port} `);

        context.nodeEvent.emit('online', this.id);

        //获取设备基本信息
        this.deviceinfo = await this.getDeviceInfo();

        //获取设备状态
        this.devicestatus = await this.getDeviceStatus();

        //获取设备目录
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

    //录像文件查询
    async getRecordInfos(channelId, begin, end) {
        return await this.QueryRecordInfo(channelId, begin, end);
    }

    //云台控制
    ControlPTZ(channelId, ptzvalue) {
        this.Control(channelId, 'PTZCmd', ptzvalue);
    }

    //重启
    ControlBoot() {
        this.Control(this.id, 'TeleBoot', 'Boot',);
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

                resolve(deviceinfo);

                return true;
            });
        });
    }

    //设备目录
    QueryDeviceCatalog() {
        return new Promise((resolve, reject) => {
            let catalog = { total: 0, devicelist: [] };
            this.Query('Catalog', (content) => {
                if (content.Result) {
                    catalog = { result: false, message: content.Result, errorcode: content.ErrorCode };
                }
                else {
                    switch (content.CmdType) {
                        case 'Catalog':
                            {
                                if (content.SumNum)
                                    catalog.total = Number(content.SumNum);

                                if (content.DeviceList) {
                                    if (catalog.total > 1) {
                                        content.DeviceList.Item.forEach(device => {
                                            catalog.devicelist.push(device);
                                        });
                                    }
                                    else {
                                        catalog.devicelist.push(content.DeviceList.Item);
                                    }
                                }
                            }
                            break;
                    }
                }
                if (catalog.total != catalog.devicelist.length)
                    return false;

                resolve(catalog);

                return true;
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

                return true;
            });
        });
    }

    //录像文件查询 
    QueryRecordInfo(channelId, startTime, endTime) {
        return new Promise((resolve, reject) => {
            let recordinfos = { total: 0, recordlist: [] };
            this.sendQueryRecordInfoMessage(channelId, startTime, endTime, (content) => {
                switch (content.CmdType) {
                    case 'RecordInfo'://设备状态
                        {
                            if (content.SumNum)
                                recordinfos.total = Number(content.SumNum);

                            if (content.RecordList) {
                                if (recordinfos.total > 0) {
                                    content.RecordList.Item.forEach(record => {
                                        recordinfos.recordlist.push(record);
                                    });
                                }
                            }
                        }
                        break;
                }

                if (recordinfos.total != recordinfos.recordlist.length) {
                    return false;
                }

                resolve(recordinfos);

                return true;
            });
        });
    }

    //控制 channelId 设备通道国标编码
    Control(channelId, cmdtype, cmdvalue, callback) {
        //PTZCmd/TeleBoot
        let json = {
            Query: {
                CmdType: 'DeviceControl',
                SN: this.sn++,
                DeviceID: channelId
            }
        };

        switch (cmdtype) {
            case 'PTZCmd':
                {
                    let cmd = Buffer.alloc(8);
                    cmd[0] = 0xA5;//首字节以05H开头
                    cmd[1] = 0x0F;//组合码，高4位为版本信息v1.0,版本信息0H，低四位为校验码
                    //  校验码 = (cmd[0]的高4位+cmd[0]的低4位+cmd[1]的高4位)%16
                    cmd[2] = 0x01;

                    let ptzSpeed = 0x5f; //默认速度

                    switch (Number(cmdvalue)) {
                        //停止
                        case 0:
                            cmd[3] = 0x00;
                            break;
                        //向右
                        case 1:
                            cmd[3] = 0x01;
                            cmd[4] = ptzSpeed;
                            break;
                        //向左
                        case 2:
                            cmd[3] = 0x02;
                            cmd[4] = ptzSpeed;
                            break;
                        //向下
                        case 3:
                            cmd[3] = 0x04;
                            cmd[5] = ptzSpeed;
                            break;
                        //向上
                        case 4:
                            cmd[3] = 0x08;
                            cmd[5] = ptzSpeed;
                            break;
                        //放大
                        case 5:
                            cmd[3] = 0x10;
                            cmd[6] = 0x10;
                            break;
                        //缩小
                        case 6:
                            cmd[3] = 0x20;
                            cmd[6] = 0x10;
                            break;
                        //组合
                        case 7:
                            cmd[3] = 0x29;
                            break;
                    }

                    cmd[7] = (cmd[0] + cmd[1] + cmd[2] + cmd[3] + cmd[4] + cmd[5] + cmd[6]) % 256;

                    json.Query.PTZCmd = this.Bytes2HexString(cmd);
                }
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
            contentType: 'application/MANSCDP+xml',
            content: content
        };

        this.send(options);
    }

    //字节转字符串
    Bytes2HexString = (b) => {
        let hexs = "";
        for (let i = 0; i < b.length; i++) {
            let hex = (b[i]).toString(16);
            if (hex.length === 1) {
                hex = '0' + hex;
            }
            hexs += hex.toUpperCase();
        }
        return hexs;
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
            contentType: 'application/MANSCDP+xml',
            content: content
        };

        this.send(options);
    }

    //发送查询通道录像文件请求
    sendQueryRecordInfoMessage(channelId, startTime, endTime, callback) {
        let json = {
            Query: {
                CmdType: 'RecordInfo',
                SN: this.sn++,
                DeviceID: channelId,
                StartTime: startTime,
                EndTime: endTime,
                Secrecy: 0, //保密属性 0：不保密 1:涉密
                Type: 'all', //录像产生类型 time/alarm/manual/all
                IndistinctQuery: 0//字段代表模糊查询，缺省为 0。 值为 0 时：不进行模糊查询。此时根据 SIP 消息中 To 头域 URI 中的 ID 值确定查询录像位置，若 ID 值为本域系统 ID 则进行中心历史记录检索，若为前端设备 ID 则进行前端设备历史记录检
            }
        };

        let id = [json.Query.CmdType, json.Query.SN].join(':');

        if (!this.callbacks[id])
            this.callbacks[id] = callback;

        //JSON 转XML
        let builder = new xml2js.Builder();
        let content = builder.buildObject(json);

        let options = {
            id: channelId,
            method: 'MESSAGE',
            contentType: 'application/MANSCDP+xml',
            content: content
        };

        this.send(options);
    }

    //下载
    Download() {

    }

    //补位0
    _prefixInteger(num, m) {
        return (Array(m).join(0) + num).slice(-m);
    }

    //回放 begin-开始时间 end-结束时间 channelId-设备通道国标编码
    sendPlaybackMessage(channelId, begin, end, nhost, nport, mode) {

        return new Promise((resolve, reject) => {
            let isFinded = false;
            let findssrc = '';
            let result = { result: true, message: 'OK' };

            for (var key in this.dialogs) {
                let session = this.dialogs[key];
                if (session.bye && session.port === rport && session.host === rhost && session.channelId === channelId && session.play === 'playback' && session.begin == begin && session.end == end) {
                    isFinded = true;
                    findssrc = session.ssrc;
                    break;
                }
            }

            if (isFinded) {
                result.data = { ssrc: findssrc };
                resolve(result);
                return;
            }
            //0: udp,1:tcp/passive ,2:tcp/active
            let selectMode = mode || 0;

            //产生1-9999随机数
            let random = Math.floor(Math.random() * 9999);

            let streamId = this._prefixInteger(random, 4);

            //回看以1开头,同一个通道编码可能存在许多不同时间段的请求，所以ssrc后四位要处理一下，不能用通道编码了
            let ssrc = "1" + channelId.substring(3, 8) + streamId;

            let host = nhost || "127.0.0.1";
            let port = nport || 9200;

            let sdpV = "";
            let mValue = "RTP/AVP"

            switch (Number(selectMode)) {
                default:
                    break;
                case 1:
                    sdpV = `a=setup:passive\r\n` +
                        `a=connection:new\r\n`;
                    mValue = "TCP/RTP/AVP";
                    break;
                case 2:
                    sdpV = `a=setup:active\r\n` +
                        `a=connection:new\r\n`;
                    mValue = "TCP/RTP/AVP";
                    break;
            }

            let content = `v=0\r\n` +
                `o=${this.GBServerId} 0 0 IN IP4 ${host}\r\n` +
                `s=Playback\r\n` +
                `u=${channelId}:0\r\n` +
                `c=IN IP4 ${host}\r\n` +
                `t=${begin} ${end}\r\n` +
                `m=video ${port} ${mValue} 96\r\n` +
                `a=rtpmap:96 PS/90000\r\n` +
                `a=recvonly\r\n` +
                sdpV +
                `y=${ssrc}\r\n` +
                `f=v/2/4///a///\r\n`;


            let that = this;

            let options = {
                id: channelId,
                subject: `${channelId}:${ssrc},${this.GBServerId}:0`,
                method: 'INVITE',
                contentType: 'application/sdp',
                content: content,
                callback: function (response) {
                    if (response.status >= 300) {
                        //错误信息
                        Logger.error(`[${that.TAG}] id=${that.id} ssrc=${ssrc} status=${response.status}`);

                        result.result = false;
                        result.data = { status: response.status };
                        result.message = `ErrorCode=${response.status}`;

                        resolve(result);
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
                                    let sdp = SDP.parse(response.content);
                                    Logger.log(`[${that.TAG}] id=${that.id} ssrc=${ssrc}  sdp=${sdp}`);
                                    //Step 6 SIP服务器收到媒体流发送者返回的200OK响应后，向 媒体服务器 发送 ACK请求，请求中携带 消息5中媒体流发送者回复的200 ok响应消息体，完成与媒体服务器的invite会话建立过程

                                    context.nodeEvent.emit('sdpReceived', sdp);

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
                                        let byeRequest = {
                                            method: 'BYE',
                                            uri: response.headers.contact[0].uri,
                                            headers: {
                                                to: response.headers.to,
                                                from: response.headers.from,
                                                'call-id': response.headers['call-id'],
                                                cseq: { method: 'BYE', seq: response.headers.cseq.seq++ }//需额外加1
                                            }
                                        }

                                        that.dialogs[key] = { channelId: channelId, ssrc: ssrc, host: host, port: port, begin: begin, end: end, bye: byeRequest, play: 'playback' };
                                    }

                                    result.data = { ssrc: ssrc };

                                    resolve(result);
                                }
                                break;
                        }
                    }
                }
            };

            this.send(options);
        });
    }

    //回看播放控制
    sendPlayControlMessage(channelId, begin, end, cmd, value) {

        return new Promise((resolve, reject) => {
            let result = { result: false, message: 'OK' };
            //PLAY/PAUSE/TEARDOWN

            //播放速度，其中 1 为正常
            let scale = ['0.25', '0.5', '1.0', '2.0', '4.0', '-0.25', '-0.5', '-1.0', '-2.0', '-4.0'];
            //播放/倍速播放/暂停/停止
            let method = ['PLAY', 'PLAY', 'PAUSE', 'TEARDOWN'];

            let findSession = null;

            for (var key in this.dialogs) {
                let session = this.dialogs[key];
                if (session.bye && session.channelId === channelId && session.play === 'playback' && session.begin == begin && session.end == end) {
                    findSession = session;
                    break;
                }
            }

            if (findSession == null) {
                result.message = 'dialog not found.';
                resolve(result);
                return;
            }

            //引用参数
            var request = SIP.copyMessage(findSession.bye);

            let findssrc = findSession.ssrc;

            if (!findSession.cseq) {
                findSession.cseq = 1;
            }
            else {
                findSession.cseq++;
            }

            if (request && findssrc) {

                request.method = 'INFO';
                request['content-type'] = 'application/MANSRTSP';
                request.headers.cseq.method = 'Info';
                request.headers.cseq.seq = Math.floor(Math.random() * 100);
                request.headers.contact = [{ uri: 'sip:' + this.GBServerId + '@' + this.GBserverHost + ':' + this.GBServerPort }];
                switch (Number(cmd)) {
                    //播放/随机播放
                    case 0:
                        {
                            request.content = "PLAY MANSRTSP/1.0\r\n" +
                                `CSeq:${findSession.cseq}\r\n` +
                                `Range:npt=${(value || 'now-')}\r\n`;
                        }
                        break;
                    //快进/慢退
                    case 1:
                        {
                            //传参数如果不符合条件，用原速播放
                            let speed = Number(value);
                            if (speed < 0 || speed > 9) {
                                speed = 2;
                            }

                            request.content = "PLAY MANSRTSP/1.0\r\n" +
                                `CSeq:${findSession.cseq}\r\n` +
                                `Scale:${scale[value]}\r\n`;
                        }
                        break;
                    //暂停(当前位置)
                    case 2:
                        {
                            request.content = "PAUSE MANSRTSP/1.0\r\n" +
                                `CSeq:${findSession.cseq}\r\n` +
                                `PauseTime:now\r\n`;
                        }
                        break;
                    //停止
                    case 3:
                        {
                            request.content = "TEARDOWN MANSRTSP/1.0\r\n" +
                                `CSeq:${findSession.cseq}\r\n`;
                        }
                        break;
                }

                //发送请求
                this.uas.send(request, (response) => {
                    //响应
                    Logger.log(`[${this.id}] INFO ${method[cmd]} result=${response.status}`);

                    if (response.status == 200) {
                        result.result = true;
                    }
                    else {
                        result.message = `ErrorCode=${response.status}`;
                        result.data = { status: response.status };
                    }

                    resolve(result);
                });
            }
        });
    }

    //预览 channelId 通道国标编码
    sendRealPlayMessage(channelId, rhost, rport, mode) {

        return new Promise((resolve, reject) => {

            let result = { result: true, message: 'OK' };

            let isFinded = false;

            let findssrc = "";

            for (var key in this.dialogs) {
                let session = this.dialogs[key];
                if (session.bye && session.port === rport && session.host === rhost && session.channelId === channelId && session.play === 'realplay') {
                    isFinded = true;
                    findssrc = session.ssrc;
                    break;
                }
            }

            //己存在会话,同一个流媒体不需要重复请求
            if (isFinded) {
                result.data = { ssrc: findssrc };
                resolve(result);
                return;
            }
            //0: udp,1:tcp/passive ,2:tcp/active
            let selectMode = mode || 0;

            let ssrc = "0" + channelId.substring(16, 20) + channelId.substring(3, 8);

            let host = rhost || "127.0.0.1";

            let port = rport || 9200;

            let sdpV = "";
            let mValue = "RTP/AVP"

            switch (Number(selectMode)) {
                default:
                    break;
                case 1:
                    sdpV = `a=setup:passive\r\n` +
                        `a=connection:new\r\n`;
                    mValue = "TCP/RTP/AVP";
                    break;
                case 2:
                    sdpV = `a=setup:active\r\n` +
                        `a=connection:new\r\n`;
                    mValue = "TCP/RTP/AVP";
                    break;
            }

            //s=Play/Playback/Download/Talk
            let content = `v=0\r\n` +
                `o=${this.GBServerId} 0 0 IN IP4 ${host}\r\n` +
                `s=Play\r\n` +
                `c=IN IP4 ${host}\r\n` +
                `t=0 0\r\n` +
                `m=video ${port} ${mValue} 96\r\n` +
                `a=rtpmap:96 PS/90000\r\n` +
                `a=recvonly\r\n` +
                sdpV +
                `y=${ssrc}\r\n` +
                `f=v/2/4///a///\r\n`;


            let that = this;

            let options = {
                id: channelId,
                subject: `${channelId}:${ssrc},${this.GBServerId}:0`,
                method: 'INVITE',
                contentType: 'application/sdp',
                content: content,
                callback: function (response) {
                    if (response.status >= 300) {
                        //错误信息
                        Logger.error(`[${that.id}] ssrc=${ssrc} status=${response.status}`);

                        result.result = false;
                        result.data = { status: response.status };
                        result.message = `ErrorCode=${response.status}`;

                        resolve(result);
                    }
                    else if (response.status < 200) {
                        Logger.log(`[${that.id} ] ssrc=${ssrc} status=${response.status}`);
                    }
                    else {
                        //判断消息类型
                        switch (options.method) {
                            case 'INVITE':

                                //SDP
                                if (response.content) {

                                    //响应消息体
                                    let sdp = SDP.parse(response.content);

                                    Logger.log(`[${that.id}] ssrc=${ssrc} sdp=${sdp}`);

                                    //Step 6 SIP服务器收到媒体流发送者返回的200OK响应后，向 媒体服务器 发送 ACK请求，请求中携带 消息5中媒体流发送者回复的200 ok响应消息体，完成与媒体服务器的invite会话建立过程

                                    context.nodeEvent.emit('sdpReceived', sdp);

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
                                        let byeRequest = {
                                            method: 'BYE',
                                            uri: response.headers.contact[0].uri,
                                            headers: {
                                                to: response.headers.to,
                                                from: response.headers.from,
                                                'call-id': response.headers['call-id'],
                                                cseq: { method: 'BYE', seq: response.headers.cseq.seq++ }//需额外加1
                                            }
                                        }

                                        that.dialogs[key] = { channelId: channelId, ssrc: ssrc, host: host, port: port, bye: byeRequest, play: 'realplay' };
                                    }

                                    result.data = { ssrc: ssrc };
                                    
                                    resolve(result);
                                }
                                break;
                        }
                    }
                }
            };

            this.send(options);
        });
    }

    //停止实时预览
    async sendStopRealPlayMessage(channelId, rhost, rport) {

        return new Promise((resolve, reject) => {
            let result = { result: false, message: 'not find dialog.' };

            for (var key in this.dialogs) {
                //搜索满足条件的会话
                let session = this.dialogs[key];

                if (session.bye && session.port === rport && session.host === rhost && session.channelId === channelId && session.play === 'realplay') {

                    context.nodeEvent.emit('stopPlayed', session.ssrc);

                    this.uas.send(session.bye, (response) => {
                        Logger.log(`[${this.id}] StopRealPlay status=${response.status}`);
                        delete this.dialogs[key];
                    });

                    result.result = true;
                    result.message = 'OK';
                }
            }

            resolve(result);
        });
    }

    //停止录像回看
    async sendStopPlayBackMessage(channelId, begin, end, nhost, nport) {

        let result = { result: false, message: 'not find dialog.' };

        for (var key in this.dialogs) {
            //搜索满足条件的会话
            let session = this.dialogs[key];
            if (session.bye && session.begin == begin && session.end == end && session.port === nport && session.host === nhost && session.channelId === channelId && session.play === 'playback') {

                //先发送停止回看命令
                result = await this.sendPlayControlMessage(session.channelId, session.begin, session.end, 3);

                context.nodeEvent.emit('stopPlayed', session.ssrc);

                //发送BYE
                this.uas.send(session.bye, (response) => {
                    Logger.log(`[${this.id}] StopPlayback status=${response.status}`);
                    delete this.dialogs[key];
                });

                break;
            }
        }

        return result;
    }

    //处理 MESSAGE 
    onMessage(request) {
        let via = request.headers.via[0];
        let content = this.parseXml(request.content);

        //网络信息      
        this.via = via;
        //连接信息
        this.contact = request.headers.contact;

        // 回复
        if (content.hasOwnProperty('Response')) {
            let id = [content.Response.CmdType, content.Response.SN].join(':');
            if (this.callbacks[id]) {

                //如果是查询有返回多条消息，还需等待。
                let result = this.callbacks[id](content.Response);

                if (result)
                    delete this.callbacks[id];
            }
        }

        // 通知
        if (content.hasOwnProperty('Notify')) {

            Logger.log(`[${this.id}] Notify CmdType=${content.Notify.CmdType} SN=${content.Notify.SN} length=${request.content.length}`);

            switch (content.Notify.CmdType) {
                //保活消息
                case 'Keepalive':
                    {
                        //更新时间
                        this.startTimestamp = Date.now();
                        this.lostPacketCount = 0;
                    }
                    break;
                //媒体播放完成消息
                case 'MediaStatus':
                    {
                        switch (content.Notify.NotifyType) {
                            //录像发送完毕
                            case 121:
                                {
                                    let key = [request.headers['call-id'], request.headers.from.params.tag, request.headers.to.params.tag].join(':');

                                    if (this.dialogs[key]) {
                                        let session = this.dialogs[key];
                                        if (session.bye && content.Notify.DeviceID == session.channelId) {
                                            this.uas.send(session.bye, (reqponse) => {
                                                if (reqponse.status == 200 || reqponse.status == 481)
                                                    delete this.dialogs[key];
                                            });
                                        }
                                    }
                                }
                                break;
                        }
                    }
                    break;
            }
        }
    }

    //发送SIP消息
    send(options) {
        //设备国标编码+设备主机地址+通讯端口
        let uri = 'sip:' + (options.id || this.id) + '@' + (this.via.params.received || this.via.host) + ':' + (this.via.params.
            rport || this.via.port);

        let request = {
            method: options.method,
            uri: uri,
            headers: {
                to: { uri: 'sip:' + (options.id || this.id) + '@' + this.GBDomain },
                from: { uri: 'sip:' + this.GBServerId + '@' + this.GBDomain, params: { tag: options.tag || this.getTagRandom(8) } },
                'call-id': this.getCallId(),
                cseq: { method: options.method, seq: Math.floor(Math.random() * 1e5) },
                'content-type': options.contentType,
                subject: options.subject,
                contact: [{ uri: 'sip:' + this.GBServerId + '@' + this.GBserverHost + ':' + this.GBServerPort }]
            },
            content: options.content
        }

        this.uas.send(request, options.callback);
    }

    //
    getSN() {
        this.sn++;

        return this.sn;
    }

    //
    getCallId() {
        return Math.floor(Math.random() * 1e6).toString() + '@' + this.GBserverHost;
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