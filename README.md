# VAG.Node
GB28181 Nodejs

Run:

node vag.js

API:

//预览开始 192.168.3.5 = StreamServerIP ,9200=Udp Port 
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001320000001/realplay/start/192.168.3.5/9200
//预览结束
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001320000001/realplay/stop/192.168.3.5/9200