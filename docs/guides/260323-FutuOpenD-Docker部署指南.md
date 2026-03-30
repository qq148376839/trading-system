# FutuOpenD Docker 部署指南

> 在 Synology NAS (x86_64) 上通过 Docker 部署 FutuOpenD，实现无 GUI 环境下的行情/交易 API 服务。

## 前置条件

| 项目 | 要求 |
|------|------|
| 硬件架构 | x86_64（ARM 不支持） |
| Docker | 已安装并可运行 |
| 网络 | 能访问 `softwaredownload.futunn.com` 和富途服务器 |
| 账号 | 富途牛牛账号（非 moomoo） |
| 手机 | 首次登录需接收短信验证码 |

## 目录结构

```
/volume1/docker/futu-opend/
├── Dockerfile
└── docker-compose.yml
```

## 第一步：准备密码 MD5

在本地终端生成密码的 MD5 值，**不要使用在线工具**（防止撞库风险）：

```bash
# macOS
echo -n '你的密码' | md5

# Linux
echo -n '你的密码' | md5sum | awk '{print $1}'
```

**注意事项：**
- `-n` 参数**必须加**，否则会多一个换行符导致 MD5 值完全不同
- 密码含特殊符号时，**用单引号**包裹（单引号内所有字符都是字面量）
- 密码本身含单引号 `'` 时，用拼接写法：`echo -n 'part1'"'"'part2' | md5`

## 第二步：创建 Dockerfile

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    curl ca-certificates libssl3 telnet python3 python3-pip \
    && pip3 install futu-api \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/opend

RUN curl -sL "https://softwaredownload.futunn.com/Futu_OpenD_10.1.6108_Ubuntu18.04.tar.gz" -o opend.tar.gz \
    && tar xzf opend.tar.gz \
    && cp -a Futu_OpenD_10.1.6108_Ubuntu18.04/Futu_OpenD_10.1.6108_Ubuntu18.04/* . \
    && rm -rf Futu_OpenD_10.1.6108_Ubuntu18.04 opend.tar.gz \
    && chmod +x FutuOpenD

ENV LD_LIBRARY_PATH=/opt/opend

ENTRYPOINT ["./FutuOpenD"]
CMD ["-login_account=你的账号", "-login_pwd_md5=你的MD5", "-api_port=11111", "-telnet_ip=127.0.0.1", "-telnet_port=22222", "-no_monitor=1", "-console=0", "-lang=chs"]
```

**关于下载链接：**
- Ubuntu 版：`https://www.futunn.com/download/fetch-lasted-link?name=opend-ubuntu`
- CentOS 版：`https://www.futunn.com/download/fetch-lasted-link?name=opend-centos`
- 上面 Dockerfile 中使用的是写死的版本号链接，升级时需更新

**关于 tar 包结构：**
- 包内有**两层嵌套目录**，可执行文件在第二层
- 可执行文件名是 `FutuOpenD`（不是 `OpenD`）
- 同目录下有多个 `.so` 动态库，必须通过 `LD_LIBRARY_PATH` 指向

## 第三步：创建 docker-compose.yml

```yaml
version: "3.8"
services:
  futu-opend:
    build: .
    container_name: futu-opend
    restart: unless-stopped
    network_mode: host
    environment:
      - TZ=Asia/Shanghai
```

**为什么用 `network_mode: host`：**
- FutuOpenD 默认监听 `127.0.0.1`，不支持 `-ip=0.0.0.0`（会报参数错误）
- 使用 host 网络后，NAS 上其他容器和宿主机可直接通过 `127.0.0.1:11111` 访问
- 不需要单独映射端口

## 第四步：构建并启动

```bash
# Synology NAS 上需要先 export PATH
export PATH=/usr/local/bin:/usr/syno/bin:$PATH

cd /volume1/docker/futu-opend
docker compose up -d --build
```

构建过程会下载 ~425MB 的 OpenD 包，首次构建需要较长时间。

## 第五步：首次登录验证（关键）

首次在新设备登录时，富途会要求**手机短信验证码**。这是一次性操作。

### 5.1 请求验证码

```bash
docker exec futu-opend python3 -c "
import telnetlib, time
tn = telnetlib.Telnet('127.0.0.1', 22222, timeout=10)
time.sleep(1)
tn.write(b'req_phone_verify_code\r\n')
time.sleep(3)
print(tn.read_very_eager().decode('utf-8', errors='replace'))
tn.close()
"
```

成功后你的手机会收到短信验证码。

**注意：** 验证码请求有频率限制（60 秒内最多 1 次），如果提示"请求过于频繁"，等待提示的秒数后重试。

### 5.2 输入验证码

```bash
docker exec futu-opend python3 -c "
import telnetlib, time
tn = telnetlib.Telnet('127.0.0.1', 22222, timeout=10)
time.sleep(1)
tn.write(b'input_phone_verify_code -code=你的验证码\r\n')
time.sleep(5)
print(tn.read_very_eager().decode('utf-8', errors='replace'))
tn.close()
"
```

成功后会输出"登录成功"以及行情权限信息。

### 5.3 如果遇到"需要图形验证码"

多次密码错误后会触发图形验证码，此时需要：

```bash
# 请求图形验证码（会返回验证码图片信息）
req_pic_verify_code

# 输入图形验证码
input_pic_verify_code -code=1234
```

**建议：确保密码 MD5 正确后再启动容器，避免多次登录失败触发图形验证码。**

## 第六步：验证服务正常

```bash
docker exec futu-opend python3 -c "
from futu import *
quote_ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
ret, data = quote_ctx.request_trading_days(market=TradeDateMarket.HK, start='2026-03-17', end='2026-03-23')
if ret == RET_OK:
    print('OK - Trading days:', data)
else:
    print('FAILED:', data)
quote_ctx.close()
"
```

## 运维命令参考

通过 Telnet（端口 22222）可执行以下管理命令：

| 命令 | 说明 | 频率限制 |
|------|------|----------|
| `req_phone_verify_code` | 请求手机验证码 | 60秒/次 |
| `input_phone_verify_code -code=123456` | 输入手机验证码 | 60秒10次 |
| `req_pic_verify_code` | 请求图形验证码 | 60秒10次 |
| `input_pic_verify_code -code=1234` | 输入图形验证码 | 60秒10次 |
| `relogin -login_pwd_md5=xxx` | 重新登录 | 1小时10次 |
| `help` | 查看所有命令 | - |
| `exit` | 退出 OpenD | - |

## 关键端口

| 端口 | 用途 | 说明 |
|------|------|------|
| 11111 | API 服务端口 | 供 futu-api SDK 连接 |
| 22222 | Telnet 管理端口 | 运维命令、验证码操作 |

## 注意事项

1. **密码错误会锁账号** — 容器设置了 `restart: unless-stopped`，如果密码错误会不断重启重试，快速消耗登录次数。发现密码错误时应立即 `docker stop futu-opend`。

2. **验证码是一次性的** — 首次在新设备登录完成验证后，后续重启容器不需要再次验证（除非更换了 IP 或长时间未登录）。

3. **不要使用 `-ip=0.0.0.0`** — FutuOpenD 不支持该参数值，会报"指定参数ip错误"。通过 `network_mode: host` 解决网络访问问题。

4. **升级 OpenD** — 需要修改 Dockerfile 中的下载链接，然后 `docker compose up -d --build`。建议先测试新版本再替换。

5. **容器内已预装 futu-api SDK** — 可直接用 `docker exec` 运行 Python 测试脚本，无需额外安装。

6. **Synology SSH 环境的 PATH** — 通过 SSH 连接 Synology NAS 时，`docker` 命令可能找不到，需要先执行 `export PATH=/usr/local/bin:/usr/syno/bin:$PATH`。

## 从其他容器连接

由于使用了 `network_mode: host`，同一 NAS 上的其他容器（如 trading-system）可通过以下方式连接：

- 如果其他容器也是 `network_mode: host`：直接连 `127.0.0.1:11111`
- 如果其他容器是 bridge 网络：连 NAS 宿主机 IP（如 `192.168.31.18:11111`）
