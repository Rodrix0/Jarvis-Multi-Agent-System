"""Puente local entre Jarvis y un control remoto infrarrojo BroadLink RM."""

import argparse
import base64
import concurrent.futures
import ipaddress
import json
import os
import socket
import sys
import time


CONFIG_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "backend", "data", "broadlink.json")
)


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {"device": {}, "codes": {}}
    with open(CONFIG_PATH, "r", encoding="utf-8") as config_file:
        return json.load(config_file)


def save_config(config):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    temp_path = CONFIG_PATH + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as config_file:
        json.dump(config, config_file, ensure_ascii=False, indent=2)
    os.replace(temp_path, CONFIG_PATH)


def import_broadlink():
    try:
        import broadlink
        return broadlink
    except ImportError as error:
        raise RuntimeError(
            "Falta la dependencia broadlink. Ejecuta: "
            "python_engine\\venv\\Scripts\\python.exe -m pip install broadlink==0.19.0"
        ) from error


def connect_device():
    broadlink = import_broadlink()
    config = load_config()
    host = config.get("device", {}).get("host")
    if not host:
        raise RuntimeError("Primero descubre el BroadLink desde el panel Control TV.")
    device = broadlink.hello(host)
    try:
        device.auth()
    except Exception as error:
        raise RuntimeError(
            "El BroadLink fue detectado, pero rechazó el control local. "
            "Desactiva 'Lock device/Bloquear dispositivo' en la app BroadLink."
        ) from error
    return device


def device_details(device):
    host = device.host[0] if isinstance(device.host, tuple) else str(device.host)
    mac = getattr(device, "mac", b"")
    authenticated = True
    try:
        device.auth()
    except Exception:
        authenticated = False
    return {
        "host": host,
        "mac": mac.hex(":") if isinstance(mac, bytes) else str(mac),
        "type": type(device).__name__,
        "devtype": getattr(device, "devtype", None),
        "authenticated": authenticated,
    }


def local_ipv4():
    """Obtiene la interfaz usada por Windows sin enviar tráfico por Internet."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    finally:
        probe.close()


def discover_devices(timeout):
    broadlink = import_broadlink()
    local_ip = local_ipv4()
    network = ipaddress.ip_network(f"{local_ip}/24", strict=False)

    # Algunos routers/Windows no reenvían el broadcast global. Probamos también
    # el broadcast dirigido de la red Wi-Fi antes de recurrir al sondeo unicast.
    devices = broadlink.discover(
        timeout=timeout,
        local_ip_address=local_ip,
        discover_ip_address=str(network.broadcast_address),
    )

    if not devices:
        def probe(host):
            try:
                return broadlink.hello(str(host), timeout=1)
            except Exception:
                return None

        hosts = [host for host in network.hosts() if str(host) != local_ip]
        with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
            devices = [device for device in executor.map(probe, hosts) if device]

    results = [device_details(device) for device in devices]

    if results:
        config = load_config()
        config.setdefault("codes", {})
        config["device"] = results[0]
        save_config(config)
    return results


def learn_button(button, timeout):
    device = connect_device()
    device.enter_learning()
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        time.sleep(1)
        try:
            packet = device.check_data()
            if packet:
                config = load_config()
                config.setdefault("codes", {})[button] = base64.b64encode(packet).decode("ascii")
                save_config(config)
                return {"button": button, "learned": True}
        except Exception as error:  # El dispositivo responde "sin datos" hasta recibir una tecla.
            last_error = str(error)
    detail = f" Última respuesta: {last_error}" if last_error else ""
    raise RuntimeError(f"No recibí la tecla {button} dentro de {timeout} segundos.{detail}")


def send_sequence(sequence, delay_ms):
    config = load_config()
    codes = config.get("codes", {})
    missing = sorted({button for button in sequence if button not in codes})
    if missing:
        raise RuntimeError("Faltan teclas aprendidas: " + ", ".join(missing))

    device = connect_device()
    for index, button in enumerate(sequence):
        device.send_data(base64.b64decode(codes[button]))
        if index < len(sequence) - 1:
            time.sleep(max(0, delay_ms) / 1000)
    return {"sent": len(sequence), "buttons": sequence}


def status():
    config = load_config()
    return {
        "configured": bool(config.get("device", {}).get("host")),
        "device": config.get("device", {}),
        "learnedButtons": sorted(config.get("codes", {}).keys()),
    }


def main():
    parser = argparse.ArgumentParser(description="Control local BroadLink para Jarvis")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover_parser = subparsers.add_parser("discover")
    discover_parser.add_argument("--timeout", type=int, default=8)

    learn_parser = subparsers.add_parser("learn")
    learn_parser.add_argument("button")
    learn_parser.add_argument("--timeout", type=int, default=20)

    send_parser = subparsers.add_parser("send-sequence")
    send_parser.add_argument("sequence_json")
    send_parser.add_argument("--delay-ms", type=int, default=350)

    subparsers.add_parser("status")
    subparsers.add_parser("check")
    args = parser.parse_args()

    if args.command == "discover":
        result = {"devices": discover_devices(args.timeout)}
    elif args.command == "learn":
        result = learn_button(args.button, args.timeout)
    elif args.command == "send-sequence":
        sequence = json.loads(args.sequence_json)
        if not isinstance(sequence, list) or not all(isinstance(item, str) for item in sequence):
            raise ValueError("La secuencia debe ser una lista JSON de botones.")
        result = send_sequence(sequence, args.delay_ms)
    elif args.command == "check":
        device = connect_device()
        result = {
            "available": True,
            "host": device.host[0] if isinstance(device.host, tuple) else str(device.host),
        }
    else:
        result = status()

    print(json.dumps({"ok": True, **result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
