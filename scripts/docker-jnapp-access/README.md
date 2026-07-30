# jnapp Docker / Compose 赋权与诊断

适用于离线安装（`install-docker-offline.sh` + `docker-29.0.4.tgz` + `docker-compose-linux-x86_64`）后，让 `jnapp` 能执行：

- `docker compose up/down`
- `docker-compose up/down`

## 文件一览

| 文件 | 谁执行 | 作用 |
|------|--------|------|
| **`root-auto.sh`** | **root** | **推荐**：全面诊断 → 按结论自动只跑需要的修复 → 复检 |
| `root-recover-docker.sh` | **root** | 紧急恢复：sock 消失 / root 也 docker 不了 |
| `root-all.sh` | **root** | 旧式总控：固定按 02→03→05→04→06 全跑 |
| `01-root-diagnose.sh` | **root** | 只诊断，不改系统 |
| `02-root-fix-group.sh` | **root** | 只修：docker 组 |
| `03-root-fix-socket.sh` | **root** | 只修：socket / daemon.json |
| `04-root-fix-compose.sh` | **root** | 只修：compose 插件/软链（不含 PATH） |
| `05-root-fix-bin-perms.sh` | **root** | 只修：二进制 + 插件父目录权限 + 软链兜底 |
| `06-root-fix-path.sh` | **root** | 只修：登录 PATH 含 `/usr/local/bin` |
| `jnapp-verify.sh` | **jnapp** | 自检 |
| `lib/common.sh` | - | 公共函数 |
| `README.md` | - | 本说明 |

## 推荐：一键智能诊断+自动修复

覆盖常见情况并**按需处理**（不会无脑全跑）：

| 诊断到的情况 | 自动动作 |
|--------------|----------|
| root `docker` 挂了 / sock 不存在 / 危险 `group.conf` | `root-recover-docker.sh` |
| **`/usr/bin/docker: Permission denied`** | **`05-root-fix-bin-perms.sh`** |
| **插件父目录 750 → `unknown command: docker compose`** | **`05`（chmod 父目录）** |
| **有插件、无 `/usr/local/bin/docker-compose` 软链** | **`05` 或 `04`** |
| **绝对路径能跑、`command not found` → PATH 缺 `/usr/local/bin`** | **`06-root-fix-path.sh`** |
| jnapp 不在 docker 组 | `02-root-fix-group.sh` |
| socket 不是 `root:docker` | `03-root-fix-socket.sh` |
| 两边都无 compose 二进制 | 需 `--from` 离线包 |
| **SELinux Enforcing + 二进制上下文非 `bin_t`** | **`05`（含 `restorecon`/`chcon` 兜底）** |
| **PATH 中存在多个 `docker-compose`（旧版 v1 等）** | 仅提示，不自动改；需人工确认优先级 |

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

**另一台机（已进组、docker run 正常、只有 compose 不行）**：跑 `root-auto.sh`；BDVIEW 权限问题优先 `05`，纯 PATH 问题跑 `06`。

### BDVIEW 实机症状对照

| 报错 | 根因 | 处理 |
|------|------|------|
| `bash: /usr/bin/docker: Permission denied` | 二进制 750/700 | `05` 或 `chmod 755 /usr/bin/docker` |
| `docker: unknown command: docker compose` | 父目录 750 或插件不可读 | `chmod 755 /usr/libexec/docker{,/cli-plugins}` + `05` |
| `docker-compose: command not found` 且 `ls` 无软链 | 缺 `/usr/local/bin` 软链 | `ln -sfn .../docker-compose /usr/local/bin/docker-compose` 或 `05` |
| `command not found` 但 `/usr/local/bin/docker-compose version` 能跑 | PATH 无 `/usr/local/bin` | **`06`** |
| 验证请用 | `su - jnapp`（带横杠） | 不要用 `su jnapp` |

```bash
# root 立刻救急（compose command not found 且插件已在）
chmod 755 /usr/libexec/docker /usr/libexec/docker/cli-plugins
chmod 755 /usr/libexec/docker/cli-plugins/docker-compose
ln -sfn /usr/libexec/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
sudo bash ./06-root-fix-path.sh
su - jnapp -c 'docker-compose version'
su - jnapp -c 'docker compose version'
```

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

## 离线安装脚本为什么会漏权限（根因）

`install-docker-offline.sh` 里安装二进制/插件的关键两行：

```bash
cp "${TMP_DIR}"/docker/* /usr/bin/
chmod +x /usr/bin/docker /usr/bin/dockerd /usr/bin/containerd /usr/bin/runc /usr/bin/ctr
cp "${COMPOSE_BIN_PATH}" /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose
```

`cp` 不带 `-p` 时按当前 `umask` 生成新文件模式，`chmod +x`（不带 `u/g/o` 前缀）同样受 `umask` 影响。若安装时 root 的 `umask` 是 `027` 或 `077`（很多加固过的服务器默认如此），实际落地权限可能是 `750`/`700`——root 自己能执行，但 `jnapp` 完全没有 `x` 位，也进不去部分目录。这正好解释了"离线安装脚本自检（root 下 `docker version` / `docker compose version`）全过，但 jnapp 不行"的现象。

`05-root-fix-bin-perms.sh` 用显式 `chmod 755`（不依赖 umask）修复，是根治而非临时绕过。

它没有验证的部分（本套脚本补上）：

- `jnapp` 是否在 docker 组、当前会话是否已生效
- `/usr/local/bin` 是否在 `jnapp` 登录 PATH
- `/usr/bin/docker`、`/usr/libexec/docker/cli-plugins` 对 `jnapp` 是否可执行/可进入
- `docker-compose`（无空格）命令是否可用，PATH 中是否有多个版本互相遮挡
- `DOCKER_HOST` / `DOCKER_CONTEXT` / `DOCKER_CONFIG` 是否把 Docker 指向了别处
- SELinux Enforcing 时二进制上下文是否正确（root unconfined 时症状会被掩盖）

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

### 方式 B：旧式全量总控（固定跑 02→03→05→04→06）

```bash
sudo bash ./root-all.sh --diagnose-only
sudo bash ./root-all.sh
```

### 方式 C：拆步执行（按序号）

```bash
# 1) 诊断
sudo bash ./01-root-diagnose.sh

# 2) 按需单项
sudo bash ./03-root-fix-socket.sh
sudo bash ./02-root-fix-group.sh --user jnapp
sudo bash ./05-root-fix-bin-perms.sh
sudo bash ./04-root-fix-compose.sh
# sudo bash ./04-root-fix-compose.sh --from /path/to/docker-compose-linux-x86_64
sudo bash ./06-root-fix-path.sh          # 纯 PATH / command not found

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
sudo bash 04-root-fix-compose.sh [--from /path/to/binary]
sudo bash 05-root-fix-bin-perms.sh
sudo bash 06-root-fix-path.sh [--user jnapp] [--force]
sudo bash root-auto.sh [--diagnose-only] [--yes] [--from ...] [--no-restart] [--user jnapp]
sudo bash root-all.sh [--diagnose-only] [--no-restart] [--user jnapp]
```

## 诊断输出怎么读

- **socket = root:root** → `03`
- **Permission denied on /usr/bin/docker / 父目录** → `05`
- **缺软链 / 插件** → `04` 或 `05`
- **绝对路径能跑、command not found** → `06`
- **两边都没有 compose** → `04 --from <离线包>`

## 常见报错对照

| 报错 | 含义 | 处理 |
|------|------|------|
| `permission denied` … `docker.sock` | socket 属组不对或组未生效 | `03`；重新登录 |
| `bash: /usr/bin/docker: Permission denied` | 二进制权限 | `05` |
| `docker: unknown command: docker compose` | 父目录/插件 | `05` / `04` |
| `docker-compose: command not found`（绝对路径能跑） | PATH | **`06`** |
| `docker-compose: command not found`（文件也不存在） | 缺软链/二进制 | `05` / `04` |
| 权限位 755 都对，jnapp 仍 permission denied | 可能是 SELinux Enforcing 上下文问题 | `getenforce` 确认后跑 `05`（含 restorecon） |
| `docker-compose` 版本不对/命令行为异常 | PATH 里有旧版（如 pip v1）排在前面 | `command -v -a docker-compose` 确认后手动清理 |

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
