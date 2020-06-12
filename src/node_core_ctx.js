
const EventEmitter = require('events');

let sessions = new Map();

let publishers = new Map();//RTMP推流客户端

let nodeEvent = new EventEmitter();

let stat = {
  inbytes: 0,
  outbytes: 0,
  accepted: 0
};
module.exports = { sessions, publishers, nodeEvent, stat };