/**
 * Created by allenshow on 5/27/15.
 */

var dgram=require("dgram");
var Buffer=require("buffer").Buffer;
var RtpPacket=require("./RtpPacket");
var RtcpServer=require("./RtcpServer");
var RtcpClient=require("./RtcpClient");

var RtpSession = function (portbase) {
    //port of rtpSocket
    this._portbase=portbase;

    //rtp socket
    this._rtpSocket=dgram.createSocket("udp4");
    this._rtpSocket.bind(portbase);

    this._rtpPacket=new RtpPacket();
};

RtpSession.prototype.setRemoteAddress=function(port,ip){
    this._remotePort = port;
    this._remoteIp = ip? ip :"127.0.0.1";
};

RtpSession.prototype.createRtcpServer=function(){
    this._rtcpServer=new RtcpServer(this._portbase+1);
    return this._rtcpServer;
};

RtpSession.prototype.createRtcpClient=function(){
    this._rtcpClient=new RtcpClient(this._portbase+1,this._remotePort+1,this._remoteIp);
    return this._rtcpClient;
};

RtpSession.prototype.getPacket=function(){
    return this._rtpPacket;
};

//with this function, RtpSession will generate a RtpPacket with a payload which has length "length" and send it. The header will auto filled.
RtpSession.prototype.sendPayload = function (payload) {
    if(this._remotePort && this._remoteIp && (payload instanceof Buffer)){

        this._rtpPacket.setPayload(payload);  //set payload
        this._rtpPacket.setSeqNumber(this._rtpPacket.getSeqNumber()+1);  //increase sequence number by 1 every time

        this._rtpPacket.setTimestamp(this._rtpPacket.getTimestamp()+1);  //increase timestamp by 1 every time

        var packet=this._rtpPacket.createBufferCopy(); //recommended, return a copy of rtpPacket
        this._rtpSocket.send(packet,0,packet.length,this._remotePort,this._remoteIp);
    }
};

//in this way, you can send a custom packet. However, you should specify your seq number and SSRC to make sure your receiver deal with the data correctly
RtpSession.prototype.sendPacket = function (packet,length) {
    if(this._remotePort && this._remoteIp && (packet instanceof Buffer)){
        this._rtpSocket.send(packet,0,length,this._remotePort,this._remoteIp);
    }
};

RtpSession.prototype.close=function(){
    this._rtpSocket.close();
};

RtpSession.prototype.on=function(event,callback){
    this._rtpSocket.on(event,callback);
};

module.exports=RtpSession;