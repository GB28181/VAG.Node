# rtp-rtcp
node module for rtp-rtcp protocol, this project is still under constructing.

## How to install
```
npm install rtp-rtcp
```
## Quick start

```
var RtpSession=require("rtp-rtcp").RtpSession;
var RtpPacket=require("rtp-rtcp").RtpPacket;

//server

var r1=new RtpSession(3000);

r1.on("listening",function(){
    console.log("rtp server is listening...");
});

r1.on("message",function(msg,info){
    var rtpPacket=new RtpPacket(msg);
    console.log(rtpPacket.getSeqNumber().toString()+" from "+info.address+" "+info.port);
});


//client

var r2=new RtpSession(3001);

r2.setRemoteAddress(3000,"localhost");

r2.on("error",function(err){
    console.log(err)
});

var payload=new Buffer("helloworld");

setInterval(function(){
    
    //send your payload, rtpsession will generate a rtppacket automatically with its private member named _rtpPacket.
    r2.sendPayload(payload);
    
    console.log("send");
},3000);
```

