#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Allocate 2 ports: one for internal dsh (127.0.0.1), one for public LAN proxy (0.0.0.0)
PORTS=$(acquire-port --wait 2)
read -r INTERNAL_PORT LAN_PORT <<< "$PORTS"

export DSH_HOME="/root/.dsh-e2e"
export DSH_TOKEN="e2etest"
export INTERNAL_PORT
export LAN_PORT

# Ensure plugin link in e2e profile points to this worktree
ln -snf "${WORKTREE_DIR}" "/root/.dsh-e2e/profiles/web/node_modules/dsh-live2d-voice"

echo "=========================================================="
echo "DSH Worktree Instance Ready:"
echo "LAN Settings URL:    http://192.168.71.80:${LAN_PORT}/?token=${DSH_TOKEN}"
echo "LAN Live URL:        http://192.168.71.80:${LAN_PORT}/live2d-voice/app?session=session-660c2454-5ea1-48a7-8962-d73a1881e536"
echo "Localhost Direct:    http://127.0.0.1:${INTERNAL_PORT}/?token=${DSH_TOKEN}"
echo "=========================================================="

# Start integrated LAN proxy in background (0.0.0.0:LAN_PORT -> 127.0.0.1:INTERNAL_PORT)
node -e '
import http from "node:http";
import net from "node:net";

const INTERNAL = parseInt(process.env.INTERNAL_PORT, 10);
const LAN = parseInt(process.env.LAN_PORT, 10);

const server = http.createServer((clientReq, clientRes) => {
  const options = {
    hostname: "127.0.0.1",
    port: INTERNAL,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: `127.0.0.1:${INTERNAL}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on("error", (err) => {
    clientRes.writeHead(502);
    clientRes.end("Proxy Error: " + err.message);
  });

  clientReq.pipe(proxyReq, { end: true });
});

server.on("upgrade", (req, socket, head) => {
  const proxySocket = net.connect(INTERNAL, "127.0.0.1", () => {
    proxySocket.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") {
        proxySocket.write(`host: 127.0.0.1:${INTERNAL}\r\n`);
      } else {
        proxySocket.write(`${key}: ${value}\r\n`);
      }
    }
    proxySocket.write("\r\n");
    if (head.length > 0) proxySocket.write(head);
    socket.pipe(proxySocket).pipe(socket);
  });
  proxySocket.on("error", () => socket.destroy());
});

server.listen(LAN, "0.0.0.0", () => {
  console.log(`[proxy] LAN forwarder running on 0.0.0.0:${LAN} -> 127.0.0.1:${INTERNAL}`);
});
' &
PROXY_PID=$!

trap 'kill -9 $PROXY_PID 2>/dev/null || true' EXIT

exec dsh web --port "$INTERNAL_PORT" --trusted-host "192.168.71.80:${LAN_PORT}" --no-open
