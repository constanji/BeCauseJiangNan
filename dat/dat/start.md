# 使用方式

  # 先赋予执行权限
  chmod +x start.sh

  # 启动所有服务
  ./start.sh

  # 停止所有服务
  ./start.sh stop

  # 重启
  ./start.sh restart

  # 查看状态
  ./start.sh status

  # 查看日志
  ./start.sh logs               # 所有服务
  ./start.sh logs dat-mongodb    # 指定服务