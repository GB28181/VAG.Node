
function getSessions(req, res, next) {
    let sessions = {};

    this.sessions.forEach(function (session, id) {
        if (session.TAG === 'sip')
            sessions[session.id] = { host: session.via.host, port: session.via.port, info: session.deviceinfo, status: session.devicestatus, catalog: session.catalog };

    });

    res.json(sessions);
}

//预览请求
function realplay(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        switch (req.params.action) {
            case 'start':
                session.RealPlay(req.params.channel, req.params.host, req.params.port, req.params.mode);
                break;
            case 'stop':
                session.StopRealPlay(req.params.channel, req.params.host, req.params.port);
                break;
        }

        result.result = true;
        result.message = 'OK';
    }
    else {
        result.result = false;
        result.message = 'device not online';
    }
    res.json(result);
}

//回看请求
function playback(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        switch (req.params.action) {
            case 'start':
                session.Playback(req.params.channel, req.params.begin, req.params.end, req.params.host, req.params.port, req.params.mode);
                break;
            case 'stop':
                session.StopRealPlay(req.params.channel, req.params.begin, req.params.end, req.params.host, req.params.port);
                break;
        }

        result.result = true;
        result.message = 'OK';
    }
    else {
        result.result = false;
        result.message = 'device not online';
    }
    res.json(result);
}

//云台控制
function ptzControl(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

        session.ControlPTZ(req.params.channel, req.params.value);

        result.result = true;
        result.message = 'OK';
    }
    else {
        result.result = false;
        result.message = 'device not online';
    }
    res.json(result);
}

//录像文件查询
async function recordQuery(req, res) {
    let result = {};

    if (this.sessions.has(req.params.device)) {
        let session = this.sessions.get(req.params.device);

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
            result.message = "beginTime 必须小于 endTime";
        }
    }
    else {
        result.result = false;
        result.message = 'device not online';
    }
    res.json(result);
}



module.exports = { realplay: realplay, getSessions: getSessions, playback: playback, ptzControl: ptzControl, recordQuery: recordQuery }