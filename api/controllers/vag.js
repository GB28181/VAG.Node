
//获取所有SIP会话
function getSessions(req, res, next) {
    let sessions = {};

    this.sessions.forEach(function (session, id) {
        if (session.TAG === 'sip')
            sessions[session.id] = { host: session.via.host, port: session.via.port, info: session.deviceinfo, status: session.devicestatus, catalog: session.catalog };
    });

    res.json(sessions);
}

//获取指定设备ID的目录数据
function getCatalog(req, res) {
    let result = { result: false, message: 'OK' };
    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        result.result = true;
        result.data = session.catalog;
    }
    else {
        result.message = 'device not online.';
    }
    res.json(result);
}

//预览请求
async function realplay(req, res) {

    let result = { result: true, message: 'OK' };

    if (this.sessions.has(req.params.device)) {

        let session = this.sessions.get(req.params.device);

        //判断当前设备通道里是否存在通道编码
        let channelId = req.params.channel;

        let channel = session.catalog.devicelist.find(t => t.DeviceID === channelId);

        if (channel) {
            switch (req.params.action) {
                case 'start':
                    {
                        result = await session.sendRealPlayMessage(channelId, req.params.host, req.params.port, req.params.mode);
                    }
                    break;
                case 'stop':
                    {
                        result = await session.sendStopRealPlayMessage(channelId, req.params.host, req.params.port);
                    }
                    break;
                default:
                    {
                        result.result = false;
                        result.message = 'action error.';
                    }
                    break;
            }
        }
        else {
            result.result = false;
            result.message = 'device not found.';
        }
    }
    else {
        result.result = false;
        result.message = 'device not online.';
    }
    res.json(result);
}

//回看请求
async function playback(req, res) {
    let result = { result: true, message: 'OK' };

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        //判断当前设备通道里是否存在通道编码
        let channelId = req.params.channel;

        let channel = session.catalog.devicelist.find(t => t.DeviceID === channelId);

        if (channel) {
            switch (req.params.action) {
                case 'start':
                    {
                        result = await session.sendPlaybackMessage(req.params.channel, req.params.begin, req.params.end, req.params.host, req.params.port, req.params.mode);
                    }
                    break;
                case 'stop':
                    {
                        result = await session.sendStopPlayBackMessage(req.params.channel, req.params.begin, req.params.end, req.params.host, req.params.port);
                    }
                    break;
                default:
                    {
                        result.result = false;
                        result.message = 'action error.';
                    }
                    break;
            }
        }
        else {
            result.result = false;
            result.message = 'device not found.';
        }
    }
    else {
        result.result = false;
        result.message = 'device not online';
    }
    res.json(result);
}

//回看播放控制
async function playControl(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        //判断当前设备通道里是否存在通道编码
        let channelId = req.params.channel;

        let channel = session.catalog.devicelist.find(t => t.DeviceID === channelId);

        if (channel) {
            result = await session.sendPlayControlMessage(req.params.channel, req.params.begin, req.params.end, req.params.cmd, req.params.value);
        }
        else {
            result.result = false;
            result.message = 'device not found.';
        }
    }
    else {
        result.result = false;
        result.message = 'device not online.';
    }
    res.json(result);
}

//云台控制
function ptzControl(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        //判断当前设备通道里是否存在通道编码
        let channelId = req.params.channel;
        let channel = session.catalog.devicelist.find(t => t.DeviceID === channelId);

        if (channel) {
            session.ControlPTZ(req.params.channel, req.params.value);

            result.result = true;
            result.message = 'OK';
        }
        else {
            result.result = false;
            result.message = 'device not found.';
        }
    }
    else {
        result.result = false;
        result.message = 'device not online.';
    }
    res.json(result);
}

//录像文件查询
async function recordQuery(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        //判断当前设备通道里是否存在通道编码
        let channelId = req.params.channel;
        let channel = session.catalog.devicelist.find(t => t.DeviceID === channelId);

        if (channel) {
            if (req.params.begin < req.params.end) {

                //unix时间转换
                var beginTime = new Date(req.params.begin * 1000).toJSON();
                var endTime = new Date(req.params.end * 1000).toJSON();

                result.data = await session.getRecordInfos(req.params.channel, beginTime, endTime);

                result.result = true;
                result.message = 'OK';
            }
            else {
                result.result = false;
                result.message = "beginTime 必须小于 endTime.";
            }
        }
        else {
            result.result = false;
            result.message = 'device not found.';
        }
    }
    else {
        result.result = false;
        result.message = 'device not online.';
    }
    res.json(result);
}

//关闭流
function closeStream(req, res) {
    let body = req.body;

    let result = { code: 0, msg: 'success' };

    if (body.stream) {
        //16位进制转10进制
        let ssrc = parseInt(body.stream, 16);
        //要补位

        ssrc = _prefixInteger(ssrc, 10);

        let selectSession = null;
        let selectDialog = null;

        for (session in this.sessions.values()) {
            let dialogs = sessson.dialogs;
            for (var key in dialogs) {
                let dialog = dialogs[key];
                if (dialog.ssrc && dialog.ssrc === ssrc) {
                    selectSession = session;
                    selectDialog = dialog;
                    return;
                }
            }
        }

        if (selectDialog != null && selectSession != null) {
            if (selectDialog.play) {
                switch (selectDialog.play) {
                    case 'realplay':
                        {
                            selectSession.StopRealPlay(selectDialog.channelId, selectDialog.host, selectDialog.port);
                        }
                        break;
                    case 'playback':
                        {
                            selectSession.StopPlayBack(selectDialog.channelId, selectDialog.begin, selectDialog.end, selectDialog.host, selectDialog.port)
                        }
                        break;
                }
            }
        }
    }

    res.json(result);
}

function _prefixInteger(num, m) {
    return (Array(m).join(0) + num).slice(-m);
}

module.exports = { getCatalog: getCatalog, realplay: realplay, getSessions: getSessions, playback: playback, ptzControl: ptzControl, playControl: playControl, recordQuery: recordQuery, closeStream: closeStream }