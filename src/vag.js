const NodeHttpServer = require('./node_http_server');
const NodeSIPServer = require('./node_GB28181SIP_server');
const NodeSIPStremServer = require('./node_GB28181Stream_server');

const config = {
    GB28181: {
        sipServer: {
            ping: 60,//心跳周期（秒）
            ping_timeout: 3,//最大心跳超时次数
            expires: 3600,//注册有效期（秒）
            host: '0.0.0.0',
            id: '34020000002000000001',
            port: 5061,
            domain: '3402000000',
            password: '12345678'//默认密码
        },
        streamServer: {
            tcpPort: 9100,
            udpPort: 9200,
            host: '0.0.0.0',
            rtmpServer: 'rtmp://127.0.0.1/live'
        }
    },
    VAG: {
        http: {
            port: 8001,
            allow_origin: '*'
        },
        auth: {
            api: true,
            api_user: 'admin',
            api_pass: 'admin',
            play: false,
            publish: false,
            secret: 'nodemedia2017privatekey'
        }
    }
};



//信令服务
let sipserver = new NodeSIPServer(config);
sipserver.run();

//网关API服务
let vagserver = new NodeHttpServer(config);
vagserver.run();

//流媒体服务
let streamserver = new NodeSIPStremServer(config);
streamserver.run();