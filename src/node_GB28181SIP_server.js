const digest = require('sip/digest');
const SIP = require('sip');
const context = require('./node_core_ctx');
const Logger = require('./node_core_logger');
const NodeSipSession = require('./node_GB28181SIP_session');

//GB28181 SIP服务器
class NodeSIPServer {
    constructor(config) {
        this.listen = config.GB28181.sipServer.listen || 5060;
        this.defaultPassword = config.GB28181.sipServer.password || '12345678';
        this.config = config;
        //临时用户信息
        this.userinfo = {};
        //会话
        this.dialogs = {};
    }

    run() {

        //监听端口，接收消息
        this.uas = SIP.create({ port: this.listen, logger: Logger }, (request) => {
            switch (request.method) {
                //当前域 注册/注销 REGISTER
                case 'REGISTER':
                    context.nodeEvent.emit('register', request);
                    break;
                //上级域/媒体接收者 INVITE
                case 'INVITE':
                    context.nodeEvent.emit('invite', request);
                    break;
                //当前域 MESSAGE 消息
                case 'MESSAGE':
                    context.nodeEvent.emit('message', request);
                    break;
                //上级域/媒体接收者 ACK/BYE Step(11/13)
                case 'ACK':
                    context.nodeEvent.emit('ack', request);
                    break;
                case 'BYE':
                    context.nodeEvent.emit('bye', request);
                    break;
                default:
                    this.uas.send(SIP.makeResponse(request, 405, 'Method not allowed'));
                    break;
            }
        });

        //注册&注销 请求
        context.nodeEvent.on('register', (request) => {
            this.auth(request);
        });

        //处理消息
        context.nodeEvent.on('message', (request) => {
            let userid = SIP.parseUri(request.headers.from.uri).user;
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
    auth(request) {

        //用户标识
        let userid = SIP.parseUri(request.headers.from.uri).user;

        //会话标识
        if (!this.userinfo[userid])
            this.userinfo[userid] = { realm: this.config.GB28181.sipServer.realm || "3402000000" };

        //判断是否携带鉴权字段
        if (!request.headers.authorization || !digest.authenticateRequest(this.userinfo[userid], request, { user: userid, password: this.defaultPassword })) {
            Logger.log(`[sip auth failed] id=${userid} ip=${request.headers.via[0].host} port=${request.headers.via[0].port} `);
            this.uas.send(digest.challenge(this.userinfo[userid], SIP.makeResponse(request, 401, 'Authentication Required')));
        }
        else {
            //通过验证 ,增加 Date 字段 （上下级和设备之间校时功能）  回复
            this.uas.send(SIP.makeResponse(request, 200, 'Ok', { Date: new Date().toJSON() }));

            //注册有效期
            let expires = request.headers.expires || this.config.GB28181.sipServer.expires;

            //注册/保存会话信息
            if (parseInt(expires) != 0) {

                let session = context.sessions.get(userid);

                if (!session) {
                    session = new NodeSipSession(this.config, this.userinfo[userid], userid, request.headers.via[0], request.headers.contact, this.uas);
                    session.run();
                }
                else {
                    session.session = this.userinfo[userid];
                }

                //过期时间
                session._expires = expires;
            }
            else {
                //注销
                if (context.sessions.has(userid)) {
                    let session = context.sessions.get(userid);
                    session.stop();

                    delete this.userinfo[userid];
                }
            }
        }
    }
}

module.exports = NodeSIPServer