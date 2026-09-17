#!/usr/bin/env bash
# AD1200 数字孪生 · 一键启动本地开发服务
# 用法:
#   ./runserver.sh          # 8080 端口，开启热更新
#   ./runserver.sh 9090     # 指定端口
#   PORT=9090 ./runserver.sh
set -euo pipefail

# 脚本移动到哪都以自身所在目录（web/）为静态根目录
cd "$(dirname "$0")"

PORT="${1:-${PORT:-8089}}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[错误] 未找到 python3，请先安装 Python 3。" >&2
  exit 1
fi

# 端口被占用时给出明确提示（有 lsof 才会检测）
if command -v lsof >/dev/null 2>&1 && lsof -i ":${PORT}" >/dev/null 2>&1; then
  echo "[错误] 端口 ${PORT} 已被占用，请换个端口: ./runserver.sh 8081" >&2
  exit 1
fi

echo "  → 启动热更新服务: http://localhost:${PORT}/"
exec python3 serve.py "${PORT}"
