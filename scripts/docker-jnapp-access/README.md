# jnapp Docker / Compose 赋权与诊断

适用于离线安装（`install-docker-offline.sh` + `docker-29.0.4.tgz` + `docker-compose-linux-x86_64`）后，让 `jnapp` 能执行：

- `docker compose up/down`
- `docker-compose up/down`

## 文件一览

| 文件 | 谁执行 | 作用 |
|------|--------|------|
| **`root-auto.sh`** | **root** | **推荐**：全面诊断 → 按结论自动只跑需要的修复 → 复检 |
| `root-recover-docker.sh` | **root** | 紧急恢复：sock 消失 / root 也 docker 不了 |
| `root-all.sh` | **root** | 旧式总控：固定按 01→04 全跑（不智能跳过） |
| `01-root-diagnose.sh` | **root** | 只诊断，不改系统 |
| `02-root-fix-group.sh` | **root** | 只修：docker 组 |
| `03-root-fix-socket.sh` | **root** | 只修：socket / daemon.json |
| `04-root-fix-compose.sh` | **root** | 只修：compose 插件/软链/PATH |
| `jnapp-verify.sh` | **jnapp** | 自检 |
| `lib/common.sh` | - | 公共函数 |
| `README.md` | - | 本说明 |

## 推荐：一键智能诊断+自动修复

覆盖常见情况并**按需处理**（不会无脑全跑）：

| 诊断到的情况 | 自动动作 |
|--------------|----------|
| root `docker` 挂了 / sock 不存在 / 危险 `group.conf` | `root-recover-docker.sh` |
| jnapp 不在 docker 组 | `02-root-fix-group.sh` |
| socket 不是 `root:docker` | `03-root-fix-socket.sh` |
| 缺 `docker-compose` 或 `docker compose` / 缺软链 | `04-root-fix-compose.sh` |
| PATH 无 `/usr/local/bin` | `04` 带 `--fix-path` |
| 两边都无 compose 二进制 | 需你提供 `--from` 离线包路径 |

```bash
# 1) 只看诊断和计划（不改系统）
sudo bash ./root-auto.sh --diagnose-only

# 2) 按计划自动修（会询问确认）
sudo bash ./root-auto.sh

# 3) 不询问，直接修
sudo bash ./root-auto.sh --yes

# 4) compose 文件完全没有时带上离线包
sudo bash ./root-auto.sh --yes --from /path/to/docker-compose-linux-x86_64
```

**另一台机（已进组、docker run 正常、只有 compose 不行）**：跑 `root-auto.sh` 即可，计划里通常只会执行 `04`。

## root 也连不上 docker（sock 不存在）？

报错类似：

```text
failed to connect to the docker API at unix:///var/run/docker.sock
no such file or directory
```

说明 **dockerd 没在跑**（常见于旧版 03 写了 `ExecStart=` 覆盖后 restart 失败）。

**立刻在 root 下执行：**

```bash
# 把更新后的脚本目录拷上来后：
sudo bash ./root-recover-docker.sh

# 或手动：
rm -f /etc/systemd/system/docker.service.d/group.conf
systemctl daemon-reload
systemctl start containerd
systemctl start docker.socket
systemctl start docker
docker ps
```

恢复成功后再考虑 jnapp 赋权：

```bash
sudo bash ./03-root-fix-socket.sh --no-restart
# 确认 docker ps 仍正常后，如需持久化再重启：
# sudo bash ./03-root-fix-socket.sh
```

## EMEP59 实机结论（重要）

| 现象 | 含义 |
|------|------|
| socket `root:root` 660 | **主因**：jnapp 在 docker 组也进不去 |
| `/usr/local/bin/docker-compose` 独立文件且 version 成功 | Compose 已够用，部署用 `docker-compose` |
| 缺 cli-plugins | 只影响 `docker compose`（带空格） |
| `containerd` inactive | root 下 docker 正常时可忽略 |

## 推荐用法

### 方式 A：智能一键（推荐）

```bash
sudo bash ./root-auto.sh --diagnose-only
sudo bash ./root-auto.sh --yes
```

### 方式 B：旧式全量总控（固定跑 02/03/04）

```bash
sudo bash ./root-all.sh --diagnose-only
sudo bash ./root-all.sh
```

### 方式 C：拆步执行（按序号）

```bash
# 1) 诊断
sudo bash ./01-root-diagnose.sh

# 2) 按需单项（EMEP59 优先 03）
sudo bash ./03-root-fix-socket.sh          # 主因
sudo bash ./02-root-fix-group.sh --user jnapp
sudo bash ./04-root-fix-compose.sh         # 可选：启用 docker compose
# sudo bash ./04-root-fix-compose.sh --from /path/to/docker-compose-linux-x86_64

# 3) 再诊断确认
sudo bash ./01-root-diagnose.sh

# 4) jnapp 重新登录后验证
bash ./jnapp-verify.sh
```

### 临时救急（仅当前 sock，重启可能丢）

```bash
chown root:docker /var/run/docker.sock
chmod 0660 /var/run/docker.sock
```

持久化请用 `03-root-fix-socket.sh`。

## 三种命令的区别

| 命令 | 含义 |
|------|------|
| `docker` | Docker CLI |
| `docker compose ...` | Compose **插件**（空格） |
| `docker-compose ...` | 兼容入口（软链或独立二进制） |

验证通过后：

```bash
docker-compose up -d
docker-compose down
# 或
docker compose up -d
docker compose down
```

## 独立脚本参数摘要

```bash
sudo bash 01-root-diagnose.sh [--user jnapp]
sudo bash 02-root-fix-group.sh [--user jnapp]
sudo bash 03-root-fix-socket.sh [--no-restart]
sudo bash 04-root-fix-compose.sh [--fix-path] [--from /path/to/binary] [--user jnapp]
sudo bash root-all.sh [--diagnose-only] [--fix-path] [--no-restart] [--user jnapp]
```

## 诊断输出怎么读

- **socket = root:root** → 先跑 `03-root-fix-socket.sh`
- **docker-compose OK，docker compose FAIL** → 可选 `04-root-fix-compose.sh`
- **docker FAIL 且 socket 已是 docker 组** → 重新登录 / `02-root-fix-group.sh`
- **两边都没有 compose** → `04-root-fix-compose.sh --from <离线包二进制>`

## 常见报错对照

| 报错 | 含义 | 处理 |
|------|------|------|
| `permission denied` … `docker.sock` | socket 属组不对或组未生效 | `03-root-fix-socket.sh`；重新登录 |
| `docker-compose: command not found` | 无二进制或 PATH | `04-root-fix-compose.sh` / `--fix-path` |
| `docker: unknown command: docker compose` | 无插件 | `04-root-fix-compose.sh`（有独立二进制会自动链接） |

## 不会做什么

- 不写 sudoers
- 不自动改 SELinux
- 不从外网下载 compose
- **不覆盖**已存在的 `/usr/local/bin/docker-compose` 大文件

## root 跑 jnapp 上传的脚本仍报 Permission denied？

```bash
chmod +x *.sh
# 推荐：用 bash 调用，避开 noexec
sudo bash ./01-root-diagnose.sh

# 或拷到 /opt 再跑
mkdir -p /opt/docker-jnapp-access
cp -a ./* /opt/docker-jnapp-access/
cd /opt/docker-jnapp-access
sed -i 's/\r$//' *.sh 2>/dev/null || true
sudo bash ./01-root-diagnose.sh
```

| 原因 | 确认 | 处理 |
|------|------|------|
| `noexec` 挂载 | `findmnt -T .` | 用 `bash 脚本.sh`，别用 `./` |
| CRLF | `file *.sh` | `sed -i 's/\r$//' *.sh` |
| NFS root_squash | home 在 NFS | 拷到 `/opt` 再跑 |
