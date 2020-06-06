/**
 * Created by allenshow on 5/28/15.
 */

var net=require("net");

var RtcpClient=function(port,remotePort,remoteIp){
    this._localPort=port;
    this._remotePort=remotePort;
    this._remoteIp=remoteIp;
    this._client=net.createConnection({
        localPort:port,
        port:this._remotePort,
        host:this._remoteIp
    })
};

RtcpClient.prototype.on=function(event,callback){
    this._client.on(event,callback);
};

module.exports=RtcpClient;