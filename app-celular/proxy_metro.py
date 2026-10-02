#!/usr/bin/env python3
# Proxy del servidor de desarrollo de Metro (puerto 8091) para exponerlo por
# tunel. Metro agrega ":8091" a las URLs del manifiesto y del bundle, pero el
# tunel Cloudflare escucha en 80/443; este proxy elimina ":8091" en respuestas
# de texto para que Expo Go (celular) pueda descargar el bundle y conectarse.
# Tambien retransmite conexiones WebSocket (/message de Metro) con tunel de
# sockets para que el recargado en vivo de Expo Go funcione.
import http.client
import re
import select
import socket
import socketserver
import time
from http.server import BaseHTTPRequestHandler

METRO_HOST = "127.0.0.1"
METRO_PORT = 8091
PUERTO = 8092
# Metro agrega ":8091" a sus URLs; el tunel escucha en 80/443. Se elimina en
# respuestas de texto para que Expo Go use la ruta correcta.
BLOQUE = ":8091"
ARREGLO = ""
LOG = "/tmp/proxy_metro.log"
# Expo Go (Android) necesita un puerto explicito en hostUri/debuggerHost para
# construir la URL del packager y el WebSocket. Como el tunel responde en el
# puerto 80, se fuerza ese puerto en esos campos del manifiesto.
PUERTO_FORZADO = ":80"


def registrar(linea):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {linea}\n")


class Manejador(BaseHTTPRequestHandler):
    def _log_peticion(self, metodo, tam=None, estado=None, extra=""):
        plt = self.headers.get("expo-platform", "-")
        pv = self.headers.get("expo-protocol-version", "-")
        host = self.headers.get("Host", self.server.server_address[0])
        ua = (self.headers.get("User-Agent", "-") or "-").split("/")[0]
        registrar(
            f"{metodo} {self.path} HOST={host} UA={ua} platform={plt} "
            f"protover={pv} estado={estado or '-'} bytes={tam or '-'} {extra}"
        )

    def _atender(self, metodo):
        longitud = int(self.headers.get("Content-Length", 0) or 0)
        cuerpo = self.rfile.read(longitud) if longitud else None

        conn = http.client.HTTPConnection(METRO_HOST, METRO_PORT, timeout=90)
        # Se conserva el Host original (dominio del tunel) y las cabeceras
        # forward de Cloudflare para que Metro genere URLs con ese dominio y
        # el esquema https.
        cab = {k: v for k, v in self.headers.items() if k.lower() not in ("accept-encoding",)}
        conn.request(metodo, self.path, body=cuerpo, headers=cab)
        res = conn.getresponse()
        datos = res.read()
        bytes_corregidos = ""
        ctype = res.getheader("Content-Type", "").split(";")[0].strip().lower()
        es_texto = ctype.startswith("text/") or ctype in (
            "application/json",
            "application/javascript",
        ) or ctype.endswith("+json") or ctype.endswith("+javascript")
        if es_texto:
            txt = datos.decode("utf-8", errors="replace")
            txt = txt.replace(BLOQUE, ARREGLO)
            # Forzar el puerto 80 en los campos hostUri y debuggerHost del
            # manifiesto si no tienen puerto explicito, para que Expo Go
            # construya URLs (http/ws) rutables por el tunel.
            txt = re.sub(
                r'("(?:hostUri|debuggerHost)":\s*")[^":]+(")',
                r"\g<1>semi-sterling-cheese-museum.trycloudflare.com:80\g<2>",
                txt,
            )
            bytes_corregidos = txt
        # Se descarta Content-Length: se recalcula con lo que entregamos.
        salida = bytes_corregidos.encode("utf-8") if bytes_corregidos else datos
        self._log_peticion(metodo, tam=len(salida), estado=res.status)
        self.send_response(res.status)
        for k, v in res.getheaders():
            if k.lower() not in ("content-length", "connection", "transfer-encoding", "content-encoding"):
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(salida)))
        self.end_headers()
        self.wfile.write(salida)
        conn.close()

    def _tunel_websocket(self):
        # Retransmision cruda de bytes hacia Metro para conexiones WebSocket.
        try:
            s = socket.create_connection((METRO_HOST, METRO_PORT), timeout=90)
        except OSError as e:
            registrar(f"WS {self.path} error conectando a Metro: {e}")
            self.send_response(502)
            self.end_headers()
            return
        primera = f"{self.command} {self.path} HTTP/1.1\r\n"
        cab = []
        for k, v in self.headers.items():
            if k.lower() == "host":
                cab.append(f"Host: {METRO_HOST}:{METRO_PORT}")
            else:
                cab.append(f"{k}: {v}")
        peticion = (primera + "\r\n".join(cab) + "\r\n\r\n").encode()
        s.sendall(peticion)
        self._log_peticion("WS", extra="tunel hacia Metro")
        self.close_connection = True
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        try:
            while True:
                legibles, _, _ = select.select([self.connection, s], [], [], 300)
                if not legibles:
                    break
                for fuente in legibles:
                    destino = s if fuente is self.connection else self.connection
                    datos = fuente.recv(65536)
                    if not datos:
                        return
                    destino.sendall(datos)
        except (OSError, ConnectionError):
            pass
        finally:
            try:
                s.close()
            except OSError:
                pass

    def do_GET(self):
        up = self.headers.get("Connection", "").lower()
        if self.headers.get("Upgrade", "").lower() == "websocket" and "upgrade" in up:
            self._tunel_websocket()
        else:
            self._atender("GET")

    def do_POST(self):
        self._atender("POST")

    def do_HEAD(self):
        self._atender("HEAD")

    def do_OPTIONS(self):
        self._atender("OPTIONS")

    def log_message(self, *args):
        pass


class Servidor(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    registrar("=== proxy iniciado ===")
    Servidor(("0.0.0.0", PUERTO), Manejador).serve_forever()