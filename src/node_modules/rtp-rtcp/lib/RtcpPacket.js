var Buffer = require('buffer').Buffer;

Number.prototype.toUnsigned = function () {
    return ((this >>> 1) * 2 + (this & 1));
};

var RtcpPacket = function (options) {

    this._bufpkt = null;

    if (options instanceof Buffer) {
        this._bufpkt = options;
        return;
    }

    var opts = options ? options : {};

    var V = opts.V ? opts.V : 2, // version. always 2 for this RFC (2 bits)
        P = opts.P ? opts.P : 0, // padding. not supported yet, so always 0 (1 bit)
        RC = opts.RC ? opts.RC : 0,// report count. (5 bit)
        PT = opts.PT ? opts.PT : 0, // packet type (8 bits)
        length = opts.length ? opts.length : 0, // marker (16 bit)
        SSRC = opts.SSRC ? opts.SSRC : 0, // synchronization source (32 bits)
        NTPtimestamp = opts.NTPtimestamp ? opts.NTPtimestamp : 0, // (64 bits)
        RTPtimestamp = opts.RTPtimestamp ? opts.RTPtimestamp : 0,  //(32 bits)
        senderPktCount = opts.senderPktCount ? opts.senderPktCount : 0, // sender's packet count (32 bits)
        senderOctetCount = opts.senderOctetCount ? opts.senderOctetCount : 0; //sender's octet count (32 bits)

    var lengthOfHeader =
            8 +
            20 +
            (CC) * 4, //totalLength of header
        buffersList = [];

    //fixed header
    var header = new Buffer(8);
    header[0] = (V << 6 | P << 5 | RC);
    header[1] = PT;
    header[2] = (length >>> 8);
    header[3] = (length & 0xFF);
    header[4] = (SSRC >>> 24);
    header[5] = (SSRC >>> 16 & 0xFF);
    header[6] = (SSRC >>> 8 & 0xFF);
    header[7] = (SSRC & 0xFF);

    buffersList.push(header);

    //sender info
    var senderInfo=new Buffer(20);

    senderInfo.writeUintBE();

    this._bufpkt = Buffer.concat(buffersList, lengthOfHeader);
};

RtcpPacket.prototype.getHeaderLength = function () {

    //fixed length
    var len = 12;

    //extensional length
    var extensionLength = this.getExtensionLength();
    if (extensionLength !== null) {
        len += (extensionLength + 1);
    }

    //CSRC counts
    len += (this.getCC());

    //return
    return len;
};

RtcpPacket.prototype.getX = function () {
    return (this._bufpkt[0] >>> 4 & 0x01);
};
RtcpPacket.prototype.setX = function (val) {
    val = val.toUnsigned();
    if (val <= 1) {
        this._bufpkt[0] &= 0xEF;
        this._bufpkt[0] |= (val << 4);
    }
};

RtcpPacket.prototype.getExtensionLength = function () {
    if (this.getX()) {
        return (this._bufpkt[14] << 8 & this._bufpkt[15]);
    } else {
        return null;
    }
};

RtcpPacket.prototype.getCC = function () {
    return (this._bufpkt[0] & 0x0F);
};
RtcpPacket.prototype.setCC = function (val) {
    val = val.toUnsigned();
    if (val <= 15) {
        this._bufpkt[0] &= 0xF0;
        this._bufpkt[0] |= val;
    }
};

RtcpPacket.prototype.getPT = function () {
    return (this._bufpkt[1] & 0x7F);
};
RtcpPacket.prototype.setPT = function (val) {
    val = val.toUnsigned();
    if (val <= 127) {
        this._bufpkt[1] &= 0x80;
        this._bufpkt[1] |= val;
    }
};

RtcpPacket.prototype.getSeqNumber = function () {
    return (this._bufpkt[2] << 8 | this._bufpkt[3]);
};
RtcpPacket.prototype.setSeqNumber = function (val) {
    val = val.toUnsigned();
    if (val <= 65535) {
        this._bufpkt[2] = (val >>> 8);
        this._bufpkt[3] = (val & 0xFF);
    }
};

RtcpPacket.prototype.getTimestamp = function () {
    return (this._bufpkt[4] << 24 | this._bufpkt[5] << 16 | this._bufpkt[6] << 8 | this._bufpkt[7]);
};
RtcpPacket.prototype.setTimestamp = function (val) {
    val = val.toUnsigned();
    if (val <= 4294967295) {
        this._bufpkt[4] = (val >>> 24);
        this._bufpkt[5] = (val >>> 16 & 0xFF);
        this._bufpkt[6] = (val >>> 8 & 0xFF);
        this._bufpkt[7] = (val & 0xFF);
    }
};

RtcpPacket.prototype.getSSRC = function () {
    return (this._bufpkt[8] << 24 | this._bufpkt[9] << 16 | this._bufpkt[10] << 8 | this._bufpkt[11]);
};
RtcpPacket.prototype.setSSRC = function (val) {
    val = val.toUnsigned();
    if (val <= 4294967295) {
        this._bufpkt[8] = (val >>> 24);
        this._bufpkt[9] = (val >>> 16 & 0xFF);
        this._bufpkt[10] = (val >>> 8 & 0xFF);
        this._bufpkt[11] = (val & 0xFF);
    }
};

RtcpPacket.prototype.getPayload = function () {
    return (this._bufpkt.slice(this.getHeaderLength(), this._bufpkt.length));
};
RtcpPacket.prototype.setPayload = function (val) {
    if (Buffer.isBuffer(val) && val.length <= 512) {
        var lengthOfHeader = this.getHeaderLength();
        var newLength = this.getHeaderLength() + val.length;
        if (this._bufpkt.length == newLength)
            val.copy(this._bufpkt, lengthOfHeader, 0);
        else {
            var newbuf = new Buffer(newLength);
            this._bufpkt.copy(newbuf, 0, 0, lengthOfHeader);
            val.copy(newbuf, lengthOfHeader, 0);
            this._bufpkt = newbuf;
        }
    }
};

RtcpPacket.prototype.getBuffer = function () {
    return this._bufpkt;
};

RtcpPacket.prototype.createBufferCopy=function(){
    return new Buffer(this._bufpkt);
};

module.exports = RtcpPacket;