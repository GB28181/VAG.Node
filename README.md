# VAG.Node
GB28181 Nodejs ，主要应用将GB28181摄像机(暂只支持IPC,NVR有点小问题) 的PS流（H264/H265）打包推送到RTMP服务器发布

Run:

node vag.js

API:

//预览开始 192.168.3.5：GB流服务主机地址 ,9200:GB流服务收流端口 ,传输模式：0:udp ,1:tcp背动,2:tcp主动

第一个 34020000001320000001 设备编码
第二个 34020000001310000001 通道编码

http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/realplay/start/192.168.3.5/9200/0


//预览结束
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/realplay/stop/192.168.3.5/9200/0

配合 RTMP 流服务器使用，推荐使用 Node-Media-Server 测试
