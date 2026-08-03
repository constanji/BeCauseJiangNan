#!/usr/bin/env bash
# ============================================================
# DAT 服务启动脚本 (替代 docker-compose.yml)
# 用法:
#   ./start.sh          启动所有服务
#   ./start.sh stop     停止所有服务
#   ./start.sh restart  重启所有服务
#   ./start.sh status   查看服务状态
#   ./start.sh logs     查看所有服务日志
#   ./start.sh logs <服务名>  查看指定服务日志
# ============================================================

set -euo pipefail

# ─── 配置 ────────────────────────────────────────────────────
NETWORK_NAME="dat-network"

# MongoDB
MONGO_IMAGE="swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/mongo:7.0"
MONGO_CONTAINER="dat-mongodb"
MONGO_PORT="${MONGODB_PORT:-27017}"
MONGO_USER="${MONGO_ROOT_USER:-root}"
MONGO_PASS="${MONGO_ROOT_PASSWORD:-Ee037159!}"

# PgVector
PG_IMAGE="swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/pgvector/pgvector:pg16"
PG_CONTAINER="dat-pgvector"
PG_PORT="${PGVECTOR_PORT:-5432}"

# DAT App
APP_IMAGE="localhost:5000/dat:latest"
APP_CONTAINER="dat-app"
OPENAPI_PORT="${OPENAPI_PORT:-8080}"
MCP_PORT="${MCP_PORT:-8081}"
JAVA_OPTS="${JAVA_OPTS:--Xms512m -Xmx2g -Dfile.encoding=UTF-8}"

# ─── 辅助函数 ────────────────────────────────────────────────

log() { echo -e "\033[1;32m[DAT]\033[0m $*"; }
err() { echo -e "\033[1;31m[ERR]\033[0m $*" >&2; }

# 检查容器是否存在（不管是否运行）
container_exists() {
    docker inspect "$1" &>/dev/null
}

# 检查容器是否正在运行
container_running() {
    [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]
}

# 创建网络
ensure_network() {
    if ! docker network inspect "$NETWORK_NAME" &>/dev/null; then
        log "创建网络: $NETWORK_NAME"
        docker network create "$NETWORK_NAME"
    fi
}

# 等待 MongoDB 就绪
wait_mongo() {
    log "等待 MongoDB 就绪..."
    local retries=30
    while ((retries-- > 0)); do
        if docker exec "$MONGO_CONTAINER" mongosh --eval "db.adminCommand('ping')" &>/dev/null; then
            log "MongoDB 已就绪"
            return 0
        fi
        sleep 2
    done
    err "MongoDB 启动超时"
    return 1
}

# ─── 启动服务 ────────────────────────────────────────────────

start_mongodb() {
    if container_running "$MONGO_CONTAINER"; then
        log "MongoDB 已在运行，跳过"
        return 0
    fi

    ensure_network

    if container_exists "$MONGO_CONTAINER"; then
        log "启动已存在的 MongoDB 容器..."
        docker start "$MONGO_CONTAINER"
        return 0
    fi

    log "创建并启动 MongoDB..."
    docker run -d \
        --name "$MONGO_CONTAINER" \
        --network "$NETWORK_NAME" \
        -p "${MONGO_PORT}:27017" \
        -v mongodb-data:/data/db \
        -e MONGO_INITDB_ROOT_USERNAME="$MONGO_USER" \
        -e MONGO_INITDB_ROOT_PASSWORD="$MONGO_PASS" \
        --security-opt seccomp=unconfined \
        --restart unless-stopped \
        "$MONGO_IMAGE"
}

start_pgvector() {
    if container_running "$PG_CONTAINER"; then
        log "PgVector 已在运行，跳过"
        return 0
    fi

    ensure_network

    if container_exists "$PG_CONTAINER"; then
        log "启动已存在的 PgVector 容器..."
        docker start "$PG_CONTAINER"
        return 0
    fi

    log "创建并启动 PgVector..."
    docker run -d \
        --name "$PG_CONTAINER" \
        --network "$NETWORK_NAME" \
        -p "${PG_PORT}:5432" \
        -e POSTGRES_USER=dat \
        -e POSTGRES_PASSWORD=dat123 \
        -e POSTGRES_DB=dat_embeddings \
        -v pgvector-data:/var/lib/postgresql/data \
        --security-opt seccomp=unconfined \
        --restart unless-stopped \
        "$PG_IMAGE"
}

start_app() {
    if container_running "$APP_CONTAINER"; then
        log "DAT App 已在运行，跳过"
        return 0
    fi

    # 先确保 MongoDB 就绪
    if container_running "$MONGO_CONTAINER"; then
        wait_mongo
    else
        err "MongoDB 未运行，无法启动 DAT App"
        return 1
    fi

    if container_exists "$APP_CONTAINER"; then
        log "启动已存在的 DAT App 容器..."
        docker start "$APP_CONTAINER"
        return 0
    fi

    log "创建并启动 DAT App..."
    docker run -d \
        --name "$APP_CONTAINER" \
        --network "$NETWORK_NAME" \
        -p "${OPENAPI_PORT}:8080" \
        -p "${MCP_PORT}:8081" \
        -e JAVA_OPTS="$JAVA_OPTS" \
        -e TZ=Asia/Shanghai \
        -e OPENAPI_PORT=8080 \
        -e MCP_PORT=8081 \
        -e "MONGODB_URI=mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_CONTAINER}:27017/dat?authSource=admin" \
        -e MONGODB_DATABASE=dat \
        -v dat-logs:/app/logs \
        --security-opt seccomp=unconfined \
        --restart unless-stopped \
        "$APP_IMAGE"
}

start_all() {
    log "========== 启动所有服务 =========="
    start_mongodb
    start_pgvector
    start_app
    log "========== 全部启动完成 =========="
    echo ""
    status_all
}

# ─── 停止服务 ────────────────────────────────────────────────

stop_all() {
    log "========== 停止所有服务 =========="
    for c in "$APP_CONTAINER" "$PG_CONTAINER" "$MONGO_CONTAINER"; do
        if container_running "$c"; then
            log "停止 $c ..."
            docker stop "$c"
        fi
    done
    log "========== 全部已停止 =========="
}

# ─── 重启服务 ────────────────────────────────────────────────

restart_all() {
    stop_all
    start_all
}

# ─── 查看状态 ────────────────────────────────────────────────

status_all() {
    log "========== 服务状态 =========="
    for c in "$MONGO_CONTAINER" "$PG_CONTAINER" "$APP_CONTAINER"; do
        if container_running "$c"; then
            local uptime
            uptime=$(docker inspect -f '{{.State.StartedAt}}' "$c" | cut -d. -f1 | tr T ' ')
            echo -e "  \033[1;32m●\033[0m $c  \033[32m运行中\033[0m  (启动于 $uptime)"
        elif container_exists "$c"; then
            echo -e "  \033[1;33m●\033[0m $c  \033[33m已停止\033[0m"
        else
            echo -e "  \033[1;31m●\033[0m $c  \033[31m未创建\033[0m"
        fi
    done
}

# ─── 查看日志 ────────────────────────────────────────────────

show_logs() {
    local target="${1:-}"
    if [[ -n "$target" ]]; then
        if container_exists "$target"; then
            docker logs -f --tail 100 "$target"
        else
            err "容器不存在: $target"
            exit 1
        fi
    else
        log "显示所有服务最近 50 行日志 (Ctrl+C 退出):"
        for c in "$MONGO_CONTAINER" "$PG_CONTAINER" "$APP_CONTAINER"; do
            echo ""
            echo -e "\033[1;36m── $c ──\033[0m"
            if container_exists "$c"; then
                docker logs --tail 50 "$c" 2>&1
            else
                echo "  (容器不存在)"
            fi
        done
    fi
}

# ─── 入口 ────────────────────────────────────────────────────

case "${1:-start}" in
    start)   start_all   ;;
    stop)    stop_all    ;;
    restart) restart_all ;;
    status)  status_all  ;;
    logs)    show_logs "${2:-}" ;;
    *)
        echo "用法: $0 {start|stop|restart|status|logs [容器名]}"
        exit 1
        ;;
esac
