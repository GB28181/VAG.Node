/**
 * Created by allenshow on 5/28/15.
 */

var net=require("net");

var RtcpServer=function(port){
    this._localPort=port;
    this._server=net.createServer();
    this._server.listen(this._localPort);
};

RtcpServer.prototype.on=function(event,callback){
    this._server.on(event,callback);
};

module.exports=RtcpServer;