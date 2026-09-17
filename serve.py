#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AD1200 数字孪生 · 本地开发服务（静态托管 + 浏览器热更新）

用法（一般不需要直接调用，请用同目录的 runserver.sh）：
    python3 serve.py [端口]        # 默认 8080

特性：
  * 静态托管当前目录，始终以 index.html 为默认首页
  * 禁用一切缓存，保证刷新即拿到最新文件
  * 注入热更新脚本：监听 web/ 下的 .html/.js/.css/.json 变更，
    变更后自动通知浏览器刷新（页面无需手动刷新）
"""
import http.server
import json
import os
import socketserver
import sys
import threading
import time
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
WATCH_EXT = {".html", ".js", ".css", ".json", ".svg", ".png", ".jpg", ".gif", ".ico"}
# 大体积静态资源不进热更新指纹：改它没必要刷新页面，且每次 stat 都白跑
SKIP_WATCH_EXT = {".mp3", ".wav", ".m4a", ".mp4", ".zip", ".pdf"}
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
POLL_INTERVAL = 0.4

class ClientQueue:
    """每个浏览器标签页一条 SSE 连接，对应一个待推送消息队列"""

    __slots__ = ("items",)

    def __init__(self):
        self.items = []

    # 允许放进 set()（默认对象即按 id 比较，这里显式声明避免歧义）
    __hash__ = object.__hash__
    __eq__ = object.__eq__


# 每个浏览器标签页一个队列：热更新脚本以 SSE 长连接挂在这里
clients = set()
clients_lock = threading.Lock()


def snapshot():
    """当前所有被监听文件的 (mtime, size) 指纹"""
    state = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext not in WATCH_EXT or ext in SKIP_WATCH_EXT:
                continue
            path = os.path.join(dirpath, name)
            try:
                st = os.stat(path)
                state[path] = (st.st_mtime_ns, st.st_size)
            except OSError:
                pass
    return state


def watcher():
    """轮询文件指纹，发现变更就广播一个 reload 事件"""
    last = snapshot()
    while True:
        time.sleep(POLL_INTERVAL)
        cur = snapshot()
        if cur != last:
            changed = sorted(
                os.path.relpath(p, ROOT)
                for p in set(cur) ^ set(last)
                if cur.get(p) != last.get(p)
            )
            last = cur
            broadcast(changed or ["?"])


def broadcast(changed):
    payload = json.dumps({"changed": changed[:10]}, ensure_ascii=False)
    dead = []
    with clients_lock:
        for queue in clients:
            try:
                queue.items.append(payload)
            except Exception:
                dead.append(queue)
        for queue in dead:
            clients.discard(queue)
    print("[watch] 已变更 -> 通知浏览器刷新: " + ", ".join(changed[:5]) + (" ..." if len(changed) > 5 else ""))


HOT_RELOAD = """<script>
/* injected by serve.py: 热更新客户端 */
(function () {
  if (window.__hotReloadInjected) return;
  window.__hotReloadInjected = true;
  var es = new EventSource('/__hot');
  es.onmessage = function (e) {
    if (e.data === 'reload') { console.log('[hot] 文件已变更，刷新页面'); location.reload(); }
  };
  es.onerror = function () { /* 服务重启时自动重连 */ };
})();
</script>
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))
        sys.stdout.flush()

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/__hot":
            return self.hot_stream()
        super().do_GET()

    def hot_stream(self):
        """SSE：保持连接，把广播的 reload 事件推给浏览器"""
        queue = ClientQueue()
        with clients_lock:
            clients.add(queue)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(b": connected\n\n")   # 首次握手，让浏览器确认通道可用
            self.wfile.flush()
            while True:
                with clients_lock:
                    pending, queue.items = list(queue.items), []
                if not pending:
                    time.sleep(0.25)
                    continue
                self.wfile.write(b"data: reload\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with clients_lock:
                clients.discard(queue)

    def send_head(self):
        """非热更新请求：HTML 响应注入热更新脚本"""
        path = unquote(urlparse(self.path).path)
        if path.endswith("/"):
            path += "index.html"
        fs_path = self.translate_path(path)
        if path.endswith(".html") or path.endswith(".htm"):
            try:
                with open(fs_path, "r", encoding="utf-8", errors="replace") as fp:
                    body = fp.read()
            except OSError:
                return super().send_head()
            if "</body>" in body:
                body = body.replace("</body>", HOT_RELOAD + "</body>", 1)
            else:
                body += HOT_RELOAD
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return None if self.command == "HEAD" else __import__("io").BytesIO(data)
        return super().send_head()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    threading.Thread(target=watcher, daemon=True).start()
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print("")
        print("  AD1200 数字孪生 · 本地服务已启动")
        print("  本地访问   http://localhost:%d/" % PORT)
        print("  静态根目录 %s" % ROOT)
        print("  热更新    已开启（改 .html/.js/.css/.json 自动刷新浏览器）")
        print("  停止服务  Ctrl + C")
        print("")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  服务已停止")


if __name__ == "__main__":
    main()
