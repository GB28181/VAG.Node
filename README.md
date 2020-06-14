# VAG.Node

GB28181 VAG(Video Agent Gateway) ，主要应用将 GB28181协议 摄像机/硬盘录像机 的PS流（H264/H265）打包推送到RTMP服务器发布.

国内用户可以使用下述镜像地址:

```bash
git clone https://gitee.com/GB28181/VAG.Node.git
```

## 使用

Run:

```bash
node vag.js
```

## API:

+ //获取所有设备/通道列表

http://localhost:8001/api/v1/vag/devices

```bash
//预览开始 192.168.3.5：GB流服务主机地址 ,9200:GB流服务收流端口 ,传输模式：0:udp ,1:tcp背动,2:tcp主动

第一个 34020000001320000001 设备编码
第二个 34020000001310000001 通道编码

http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/realplay/start/192.168.3.5/9200/0

//预览结束
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/realplay/stop/192.168.3.5/9200/0
```

+ //云台控制

0：停止
1：向右
2：向左
3：向下
4：向上
5：放大
6：缩小
7：组合(暂不支持)

```bash
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/ptz/0
```

+ 录像文件查询 ，按时间unix传值 ， 1583141099：开始时间 ，1584161099： 结束时间

```bash
http://localhost:8001/api/v1/vag/devices/34020000001110000001/34020000001320000001/recordQuery/1592021099/1592161099
```

+ 录像回看 (暂未通过测试)

```bash
http://localhost:8001/api/v1/vag/devices/34020000001110000001/34020000001320000001/playback/start/1592029748/1592161099/192.168.3.5/9200/0
```
配合 RTMP 流服务器使用，推荐使用 Node-Media-Server 测试
