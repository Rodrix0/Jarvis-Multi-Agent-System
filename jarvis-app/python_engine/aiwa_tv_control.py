"""Controlador de red Wi-Fi para Smart TV AIWA (Google Cast / Android TV)."""

import argparse
import json
import sys
import pychromecast

DEFAULT_HOST = "192.168.1.8"
DEFAULT_PORT = 8009
DEFAULT_NAME = "Sala de estar"

def get_chromecast_client(host=DEFAULT_HOST, timeout=3):
    try:
        cast = pychromecast.get_chromecast_from_host((host, DEFAULT_PORT, 'cast', DEFAULT_NAME, 'Chromecast'))
        cast.wait(timeout=timeout)
        return cast
    except Exception as e:
        # Fallback to discovery if static IP failed
        try:
            chromecasts, browser = pychromecast.get_listed_chromecasts(friendly_names=[DEFAULT_NAME], timeout=timeout)
            if chromecasts:
                cast = chromecasts[0]
                cast.wait(timeout=timeout)
                return cast
        except Exception:
            pass
        raise RuntimeError(f"No se pudo conectar con la Smart TV AIWA en {host}: {e}")

def cmd_get_volume(args):
    cast = get_chromecast_client(args.host)
    vol = round(cast.status.volume_level * 100)
    muted = bool(cast.status.volume_muted)
    cast.disconnect()
    return {
        "ok": True,
        "volume": vol,
        "muted": muted,
        "device": cast.name or DEFAULT_NAME
    }

def cmd_set_volume(args):
    percent = max(0, min(100, int(args.percent)))
    cast = get_chromecast_client(args.host)
    cast.set_volume(percent / 100.0)
    # Leer confirmación
    vol = round(cast.status.volume_level * 100)
    muted = bool(cast.status.volume_muted)
    cast.disconnect()
    return {
        "ok": True,
        "volume": percent,
        "actualVolume": vol,
        "muted": muted,
        "device": DEFAULT_NAME
    }

def cmd_adjust_volume(args):
    delta = int(args.delta)
    cast = get_chromecast_client(args.host)
    current_vol = round(cast.status.volume_level * 100)
    new_vol = max(0, min(100, current_vol + delta))
    cast.set_volume(new_vol / 100.0)
    muted = bool(cast.status.volume_muted)
    cast.disconnect()
    return {
        "ok": True,
        "previousVolume": current_vol,
        "volume": new_vol,
        "muted": muted,
        "device": DEFAULT_NAME
    }

def cmd_toggle_mute(args):
    cast = get_chromecast_client(args.host)
    new_muted = not bool(cast.status.volume_muted)
    cast.set_volume_muted(new_muted)
    cast.disconnect()
    return {
        "ok": True,
        "muted": new_muted,
        "device": DEFAULT_NAME
    }

def main():
    parser = argparse.ArgumentParser(description="AIWA TV Google Cast Control")
    parser.add_argument("--host", default=DEFAULT_HOST, help="TV IP address")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("get-volume")
    
    set_parser = subparsers.add_parser("set-volume")
    set_parser.add_argument("--percent", type=int, required=True, help="Volume level 0-100")

    adj_parser = subparsers.add_parser("adjust-volume")
    adj_parser.add_argument("--delta", type=int, required=True, help="Volume delta (-100 to 100)")

    subparsers.add_parser("toggle-mute")

    args = parser.parse_args()

    commands = {
        "get-volume": cmd_get_volume,
        "set-volume": cmd_set_volume,
        "adjust-volume": cmd_adjust_volume,
        "toggle-mute": cmd_toggle_mute,
    }

    try:
        result = commands[args.command](args)
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)
    except Exception as err:
        print(json.dumps({"ok": False, "error": str(err)}, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
