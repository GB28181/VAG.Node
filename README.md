# VAG.Node

GB28181 VAG(Video Agent Gateway) ，主要应用将 GB28181协议 摄像机/硬盘录像机 的PS流（H264/H265）打包推送到RTMP服务器发布.

国内用户可以使用下述镜像地址:

```bash
git clone https://gitee.com/GB28181/VAG.Node.git
```

## 使用

Run:

step 1: `npm install` 或 `yarn`

step 2: `node vag.js`


**注意：如果需要对接的流媒体服务器具备 GB28181/PS/RTP 流处理能力的，请将配置 `streamServer: { enable: true }` 中,enable 设置为false,这样将不启用内置的流媒体接收转换功能，支持SRS4.0,ZLMediaKit**


## API:

+ `/api/v1/vag/devices` 获取设备/通道列表
+ `/api/v1/vag/devices/{DeviceID}/{ChannelID}/ptz/{ControlCode}` 云台控制
+ `/api/v1/vag/devices/{DeviceID}/{ChannelID}/recordQuery/{starttime}/{endtime}` 录像文件查询<按unix时间段> .
+  `/api/v1/vag/devices/{DeviceID}/{ChannelID}/realplay/{Action}/{MediaHost}/{MediaPort}/{streamMode}` 实时预览
+  `/api/v1/vag/devices/{DeviceID}/{ChannelID}/playback/{Action}/{starttime}/{endtime}/{MediaHost}/{MediaPort}/{streamMode}` 录像回看

ControlCode： 0：停止/1：向右/2：向左/3：向下/4：向上/5：放大/6：缩小/7：组合(暂不支持)

Action :start/stop

streamMode ： 0:udp ,1:tcp被动,2:tcp主动

注意 PTZ默认速度5，暂不支持自定义速度，点击开始后云台不会停止，直到再次请求接口发送控制码0，才会停止动作


## 示例：

目标设备： 

34020000001320000001 设备编码
34020000001310000001 通道编码

流媒体服务器：

 192.168.3.5：媒体流接收者
 9200: 媒体流流接收者端口

1、视频播放

//开始预览

```bash
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/realplay/start/192.168.3.5/9200/0
```

输出结果：

```bash
{"data":{"ssrc":"0200004754"},"result":true,"message":"OK"}
```

说明： 如果对接是ZLMediaKit 取ssrc转换为16进行后=0BEBD193，0BEBD193就是ZK里的流id

//停止预览

```bash
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/realplay/stop/192.168.3.5/9200/0
```

2、 云台控制 

```bash
http://localhost:8001/api/v1/vag/devices/34020000001320000001/34020000001310000001/ptz/0
```

3、录像查询

 按时间段(unix时戳)进行录像文件查询.

```bash
http://localhost:8001/api/v1/vag/devices/34020000001110000001/34020000001320000001/recordQuery/1592021099/1592161099
```

其中 ：

```bash
34020000001320000001 设备编码 

34020000001310000001为通道编码

1583141099：开始时间  

1584161099： 结束时间
```

4、录像回看/停止 

//开始回看

```bash
http://localhost:8001/api/v1/vag/devices/34020000001110000001/34020000001320000001/playback/start/1592029748/1592161099/192.168.3.5/9200/0
```

//停止回看

```bash
http://localhost:8001/api/v1/vag/devices/34020000001110000001/34020000001320000001/playback/stop/1592029748/1592161099/192.168.3.5/9200/0
```

其中：

34020000001320000001 设备编码 

34020000001310000001为通道编码

1592029748：开始时间 

1592161099： 结束时间

192.168.3.5: host 

9200 : port

0: streamMode 


## 更多

可以配合 RTMP 流服务器使用，RTMP 流服务 推荐使用 Node-Media-Server 进行测试
