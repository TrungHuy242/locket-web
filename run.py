"""Starts the Locket web app (API + frontend) on one port.

    python run.py                 http://localhost:8000
    python run.py --lan --https   reachable from a phone on the same Wi-Fi (camera needs HTTPS there)
"""
from __future__ import annotations

import argparse
import datetime
import ipaddress
import socket
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
CERT_DIR = ROOT / "backend" / "data" / "certs"


def lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def ensure_cert(ip: str):
    """Self-signed certificate so getUserMedia works when the app is opened from a phone."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    CERT_DIR.mkdir(parents=True, exist_ok=True)
    key_path, cert_path = CERT_DIR / f"{ip}.key", CERT_DIR / f"{ip}.crt"
    if key_path.exists() and cert_path.exists():
        return key_path, cert_path
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Locket Web (local)")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([
            x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.IPAddress(ipaddress.ip_address(ip)),
        ]), critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                           serialization.NoEncryption()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return key_path, cert_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Locket web app")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--lan", action="store_true", help="listen on all interfaces (phone on the same Wi-Fi)")
    parser.add_argument("--https", action="store_true", help="serve over HTTPS with a self-signed certificate")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    ip = lan_ip() if args.lan else "127.0.0.1"
    kwargs = {}
    scheme = "http"
    if args.https:
        key_path, cert_path = ensure_cert(ip)
        kwargs.update(ssl_keyfile=str(key_path), ssl_certfile=str(cert_path))
        scheme = "https"
    print(f"\n  Locket Web  ->  {scheme}://localhost:{args.port}")
    if args.lan:
        print(f"  Phone (LAN) ->  {scheme}://{ip}:{args.port}")
    print()
    uvicorn.run("backend.app.main:app", host=host, port=args.port, reload=args.reload, **kwargs)


if __name__ == "__main__":
    main()
