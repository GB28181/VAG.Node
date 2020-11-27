const digest = require('./sip/digest');
const SIP = require('./sip/sip');
const context = require('./core/ctx');
const Logger = require('./core/logger');
const NodeSipSession = require('./GB28181Session');

//GB28181 SIP服务器
class NodeSIPServer {
    constructor(config) {
        this.listen = config.GB28181.sipServer.listen || 5060;
        this.host = config.GB28181.sipServer.host || '127.0.0.1';//SIP服务器主机地址
        this.defaultPassword = config.GB28181.sipServer.password || '12345678';
        this.id=config.GB28181.sipServer.serial||'34020000002000000001';
        this.config = config;
        //临时用户信息
        this.userinfo = {};
        //会话
        this.dialogs = {};
    }

    run() {

        //监听端口，接收消息
        this.uas = SIP.create({ publicAddress: this.host, port: this.listen }, (request, remote) => {
            switch (request.method) {
                //当前域 注册/注销 REGISTER
                case 'REGISTER':
                    context.nodeEvent.emit('register', request, remote);
                    break;
                //上级域/媒体接收者 INVITE
                case 'INVITE':
                    context.nodeEvent.emit('invite', request, remote);
                    break;
                //当前域 MESSAGE 消息
                case 'MESSAGE':
                    context.nodeEvent.emit('message', request, remote);
                    break;
                //上级域/媒体接收者 ACK/BYE Step(11/13)
                case 'ACK':
                    context.nodeEvent.emit('ack', request, remote);
                    break;
                case 'BYE':
                    context.nodeEvent.emit('bye', request, remote);
                    break;
                default:
                    this.uas.send(SIP.makeResponse(request, 405, 'Method not allowed'));
                    break;
            }
        });

        //注册&注销 请求
        context.nodeEvent.on('register', (request, remote) => {
            this.auth(request, remote);
        });

        //处理消息
        context.nodeEvent.on('message', (request) => {

            this.uas.send(SIP.makeResponse(request, 200, 'Ok'));

            let userid = SIP.parseUri(request.headers.from.uri).user;
            //处理消息
            if (context.sessions.has(userid)) {
                let session = context.sessions.get(userid);
                session.onMessage(request);
            }
        });

        Logger.log(`Node Media GB28181 Sip-Server started on port: ${this.listen}`);
    }

    stop() {
        //服务器下线
        this.uas.destroy();
    }

    //身份验证
    auth(request, remote) {

        let serverInfo = SIP.parseUri(request.uri);

        if (!request.headers || !request.headers.to || !request.headers.from || !serverInfo.user) {
            this.uas.send(SIP.makeResponse(request, 400, 'missing to header.'));
            return;
        }
        else if (!request.headers.to.uri) {
            this.uas.send(SIP.makeResponse(request, 400, 'missing username on to header.'));
            return;
        }
        else if (!request.headers.contact || request.headers.contact.length == 0) {
            this.uas.send(SIP.makeResponse(request, 400, 'missing contact header.'));
            return;
        }

        let toInfo = SIP.parseUri(request.headers.to.uri);

        let fromInfo = SIP.parseUri(request.headers.from.uri);

        //用户 标识
        let userId = fromInfo.user;

        Logger.log(`[${userId}] register protocol=${remote.protocol} ip=${remote.address} port=${remote.port} `);

        //安全性检查
        if (toInfo.user.length != 20 || fromInfo.user.length != 20 || toInfo.user != fromInfo.user || serverInfo.user != this.id) {
            Logger.log(`[${userId}] check fail. `);
            return;
        }

        //判断是否携带鉴权字段
        if (!this.userinfo[userId] || !request.headers.authorization) {

            //会话标识
            this.userinfo[userId] = { realm: this.domain };

            Logger.log(`[${userId}] auth start. `);

            this.uas.send(digest.challenge(this.userinfo[userId], SIP.makeResponse(request, 401, 'Authentication Required.')));
            return;
        }
        else {

            if (request.headers.authorization && !digest.authenticateRequest(this.userinfo[userId], request, { password: this.defaultPassword })) {
                this.uas.send(digest.challenge(this.userinfo[userId], SIP.makeResponse(request, 406, 'Not Acceptable.')));
                Logger.log(`[${userId}] auth fail. `);
                return;
            }

            delete this.userinfo[userId];

            Logger.log(`[${userId}] auth success. `);
        }

        //注册有效期
        let expires = request.headers.expires;

        //注册/保存会话信息
        if (parseInt(expires) != 0) {

            //新的会话
            if (context.sessions.has(userId)) {

                let session = context.sessions.get(userId);

                //在注册有效期内，刷新注册还是重新注册

                //重新注册
                if (session.request.headers['call-id'] != request.headers['call-id']) {
                    //重新注册是否需要断开之前的会话

                    let dialogs = [];

                    context.dialogs.forEach(dialog => {
                        if (dialog.deviceId === userId)
                            dialogs.push(dialog);
                    });

                    //删除对话
                    dialogs.forEach(dialog => {
                        let index = context.dialogs.indexOf(dialog);
                        if (index > -1) {
                            context.dialogs.splice(index, 1);
                        }
                    });

                    session.request = request;
                }

                //刷新过期时间
                session.expires = expires || this.expires;

                Logger.log(`[${userId}] device register refresh.`);
            }
            else {
                //新的设备加入
                let session = new NodeSipSession(this.config, userId, { request: request, info: remote }, this.uas);
                session.expires = expires || this.expires;
                session.run();
            }
        }
        else {
            //注销
            if (context.sessions.has(userId))
                context.nodeEvent.emit('logout', context.sessions.get(userId));
        }

        //通过验证 ,增加 Date 字段 （上下级和设备之间校时功能） 
        this.uas.send(SIP.makeResponse(request, 200, 'OK', { headers: { date: this.getNowTimeParse(), expires: (expires || this.expires) } }));
    }

    //获取当前时间
    getNowTimeParse() {

        const time = new Date();

        const YYYY = time.getFullYear();

        const MM = time.getMonth() < 9 ? '0' + (time.getMonth() + 1) : (time.getMonth() + 1);

        const DD = time.getDate() < 10 ? '0' + time.getDate() : time.getDate();

        const hh = time.getHours() < 10 ? '0' + time.getHours() : time.getHours();

        const mm = time.getMinutes() < 10 ? '0' + time.getMinutes() : time.getMinutes();

        const ss = time.getSeconds() < 10 ? '0' + time.getSeconds() : time.getSeconds();

        const ms = time.getMilliseconds()

        return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}.${ms}`;
    }
}

module.exports = NodeSIPServer
