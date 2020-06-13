const NodeHttpServer = require('./node_http_server');
const NodeSIPServer = require('./node_GB28181SIP_server');
const NodeSIPStremServer = require('./node_GB28181Stream_server');

const config = {
    GB28181: {
        sipServer: {
            ping: 60,//心跳周期（秒）
            ping_timeout: 3,//最大心跳超时次数
            expires: 3600,//注册有效期（秒）
            host: '0.0.0.0',//本地地址
            mapHost: '127.0.0.1',//外网IP地址
            serial: '34020000002000000001',//SIP服务器编号
            listen: 5061,//SIP通信端口
            realm: '3402000000',//SIP服务器域
            password: '12345678',//默认密码
            ack_timeout: 30,//服务端发送ack后，接收回应的超时时间，单位为秒,如果指定时间没有回应，认为失败
        },
        streamServer: {
            enable: true,//是否启用内置流媒体服务 接收/转码/RTMP推送功能
            listen: 9200,//接收设备端rtp流的多路复用端口
            audio_enable: false,//是否转发音频流
            rtp_idle_timeout: 30,//rtp包空闲等待时间，如果指定时间没有收到任何包,rtp监听连接自动停止，发送BYE命令
            rtp_mix_port: 9200,//rtp接收监听端口范围，最小值
            rtp_max_port: 11200,//rtp接收监听端口范围，最大值           
            invite_port_fixed: true,//设备将流发送的端口，是否固定,true:发送流到多路复用端口 如9000,false:动从rtp_mix_port - rtp_max_port 之间的值中选一个可以用的端口
            host: '0.0.0.0',//本地地址
            rtmpServer: 'rtmp://127.0.0.1/live'//RTMP服务器基地址
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
if (config.GB28181.streamServer.enable) {
    let streamserver = new NodeSIPStremServer(config);
    streamserver.run();
}