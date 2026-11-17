#!/usr/bin/env python3
"""
ScreenSync Native Linux Desktop Companion & Local HTTP Bridge (Pass 24 Cross-OS Native App Name & Original Icon Extraction).
Provides:
1. DMI/sysfs hardware marketing name resolution (/sys/devices/virtual/dmi/id/*)
2. X11 (xprop) and Wayland (gdbus / swaymsg / hyprctl / playerctl MPRIS) active window & short-form feed detection
3. XDG .desktop entry & hicolor/pixmaps icon resolution (Name= & Icon= -> PNG/SVG Data URI)
4. User idle time detection (xprintidle / org.gnome.Mutter.IdleMonitor D-Bus)
5. Audio volume / SPL estimation (pactl / wpctl)
6. Local HTTP JSON server on 127.0.0.1:19540 (/api/companion/poll, /api/companion/device, /api/companion/installed-apps, /api/companion/store-status)
"""

import base64
import hashlib
import hmac
import http.server
import py_compile
import json
import os
import pathlib
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional

COMPANION_VERSION = "3.5.0"  # Pass 25: "3.3.0" (Build 33)
DEFAULT_PORT = 19540

_LINUX_DESKTOP_APP_CACHE: Dict[str, Dict[str, Any]] = {}

XDG_APPLICATION_DIRS = [
    "/usr/share/applications",
    "/usr/local/share/applications",
    os.path.expanduser("~/.local/share/applications"),
    "/var/lib/flatpak/exports/share/applications",
    "/var/lib/snapd/desktop/applications",
]

XDG_ICON_SEARCH_DIRS = [
    "/usr/share/icons/hicolor/64x64/apps",
    "/usr/share/icons/hicolor/48x48/apps",
    "/usr/share/icons/hicolor/128x128/apps",
    "/usr/share/icons/hicolor/scalable/apps",
    "/usr/share/pixmaps",
    os.path.expanduser("~/.local/share/icons/hicolor/64x64/apps"),
    "/var/lib/flatpak/exports/share/icons/hicolor/64x64/apps",
    "/var/lib/flatpak/exports/share/icons/hicolor/scalable/apps",
]

GENERIC_DMI_PLACEHOLDERS = {
    "system product name",
    "to be filled by o.e.m.",
    "default string",
    "invalid",
    "none",
    "not specified",
    "system manufacturer",
    "system version",
    "all series",
    "undefined",
    "unknown",
}


def _read_text_safe(file_path: pathlib.Path) -> str:
    try:
        if file_path.exists():
            return file_path.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception:
        pass
    return ""


def _is_generic_placeholder(val: str) -> bool:
    cleaned = (val or "").strip()
    if not cleaned:
        return True
    return cleaned.lower() in GENERIC_DMI_PLACEHOLDERS


def _encode_icon_file_to_data_uri(icon_path: pathlib.Path) -> Optional[str]:
    try:
        if not icon_path.exists() or not icon_path.is_file():
            return None
        suffix = icon_path.suffix.lower()
        raw_bytes = icon_path.read_bytes()
        if not raw_bytes:
            return None
        b64 = base64.b64encode(raw_bytes).decode("ascii")
        if suffix == ".png":
            return f"data:image/png;base64,{b64}"
        if suffix == ".svg":
            return f"data:image/svg+xml;base64,{b64}"
    except Exception:
        pass
    return None


def _resolve_icon_name_to_data_uri(icon_spec: str) -> Optional[str]:
    cleaned = (icon_spec or "").strip()
    if not cleaned:
        return None
    direct_path = pathlib.Path(cleaned)
    if direct_path.is_Absolute() if hasattr(direct_path, "is_Absolute") else direct_path.is_absolute():
        return _encode_icon_file_to_data_uri(direct_path)

    for search_dir in XDG_ICON_SEARCH_DIRS:
        base_dir = pathlib.Path(search_dir)
        if not base_dir.exists():
            continue
        for ext in ("", ".png", ".svg"):
            cand = base_dir / f"{cleaned}{ext}"
            uri = _encode_icon_file_to_data_uri(cand)
            if uri:
                return uri
    return None


def _parse_desktop_file(desktop_path: pathlib.Path) -> Optional[Dict[str, str]]:
    try:
        content = desktop_path.read_text(encoding="utf-8", errors="ignore")
        in_desktop_entry = False
        name_val = ""
        icon_val = ""
        wm_class_val = ""
        exec_val = ""
        no_display = False
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("[") and line.endswith("]"):
                in_desktop_entry = line == "[Desktop Entry]"
                continue
            if not in_desktop_entry or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            if k == "Name" and not name_val:
                name_val = v
            elif k == "Icon" and not icon_val:
                icon_val = v
            elif k == "StartupWMClass" and not wm_class_val:
                wm_class_val = v
            elif k == "Exec" and not exec_val:
                exec_val = v.split()[0].strip('"') if v.split() else ""
            elif k == "NoDisplay" and v.lower() == "true":
                no_display = True
        if not name_val:
            return None
        return {
            "name": name_val,
            "icon": icon_val,
            "wm_class": wm_class_val,
            "exec": os.path.basename(exec_val) if exec_val else "",
            "stem": desktop_path.stem,
            "path": str(desktop_path),
            "no_display": "true" if no_display else "false",
        }
    except Exception:
        return None


def resolve_linux_desktop_app_identity(wm_class_or_proc: str) -> Dict[str, Any]:
    """
    Pass 24 Task 24.3 (4.3): Resolves a Linux WM_CLASS or process name against XDG .desktop
    entries and hicolor/pixmaps icon themes, preserving the exact Name= and encoding the icon
    into a data:image/png;base64,... or data:image/svg+xml;base64,... Data URI.
    """
    raw_query = (wm_class_or_proc or "").strip()
    if not raw_query:
        return {
            "appName": "Linux Desktop",
            "iconDataUri": None,
            "desktopFile": None,
            "isNativeOsLabel": True,
        }
    cache_key = raw_query.lower()
    if cache_key in _LINUX_DESKTOP_APP_CACHE:
        return _LINUX_DESKTOP_APP_CACHE[cache_key]

    resolved_name = raw_query
    icon_data_uri: Optional[str] = None
    matched_path: Optional[str] = None

    for app_dir_str in XDG_APPLICATION_DIRS:
        app_dir = pathlib.Path(app_dir_str)
        if not app_dir.exists() or not app_dir.is_dir():
            continue
        try:
            for desktop_file in app_dir.glob("*.desktop"):
                parsed = _parse_desktop_file(desktop_file)
                if not parsed:
                    continue
                candidates = {
                    parsed["stem"].lower(),
                    parsed["wm_class"].lower(),
                    parsed["exec"].lower(),
                    parsed["name"].lower(),
                }
                if cache_key in candidates or any(
                    c and (c == cache_key or c.endswith(f".{cache_key}")) for c in candidates
                ):
                    resolved_name = parsed["name"]
                    matched_path = parsed["path"]
                    icon_data_uri = _resolve_icon_name_to_data_uri(parsed["icon"])
                    break
        except Exception:
            pass
        if matched_path:
            break

    result = {
        "appName": resolved_name,
        "iconDataUri": icon_data_uri,
        "desktopFile": matched_path,
        "isNativeOsLabel": True,
    }
    _LINUX_DESKTOP_APP_CACHE[cache_key] = result
    return result


def discover_installed_linux_applications() -> List[Dict[str, Any]]:
    apps: List[Dict[str, Any]] = []
    seen_names = set()
    for app_dir_str in XDG_APPLICATION_DIRS:
        app_dir = pathlib.Path(app_dir_str)
        if not app_dir.exists() or not app_dir.is_dir():
            continue
        try:
            for desktop_file in app_dir.glob("*.desktop"):
                parsed = _parse_desktop_file(desktop_file)
                if not parsed or parsed.get("no_display") == "true":
                    continue
                app_name = parsed["name"]
                if app_name.lower() in seen_names:
                    continue
                seen_names.add(app_name.lower())
                icon_uri = _resolve_icon_name_to_data_uri(parsed["icon"])
                apps.append(
                    {
                        "name": app_name,
                        "appName": app_name,
                        "packageId": parsed["stem"],
                        "iconDataUri": icon_uri,
                        "desktopFile": parsed["path"],
                        "isNativeOsLabel": True,
                    }
                )
        except Exception:
            pass
    return apps


def resolve_linux_hardware_marketing_name(
    dmi_root: str = "/sys/devices/virtual/dmi/id",
    vendor_override: Optional[str] = None,
    product_name_override: Optional[str] = None,
    product_version_override: Optional[str] = None,
) -> str:
    """
    Reads /sys/devices/virtual/dmi/id/sys_vendor, product_name, and product_version,
    strips OEM placeholders, and returns a clean human-readable hardware marketing name.
    """
    base = pathlib.Path(dmi_root)
    raw_vendor = (
        vendor_override
        if vendor_override is not None
        else _read_text_safe(base / "sys_vendor")
    )
    raw_name = (
        product_name_override
        if product_name_override is not None
        else _read_text_safe(base / "product_name")
    )
    raw_version = (
        product_version_override
        if product_version_override is not None
        else _read_text_safe(base / "product_version")
    )

    vendor = "" if _is_generic_placeholder(raw_vendor) else raw_vendor.strip()
    name = "" if _is_generic_placeholder(raw_name) else raw_name.strip()
    version = "" if _is_generic_placeholder(raw_version) else raw_version.strip()

    vendor_norm = vendor
    if vendor.lower() in ("dell inc.", "dell computer corporation"):
        vendor_norm = "Dell"
    elif vendor.lower() in ("lenovo", "lenovo group limited"):
        vendor_norm = "Lenovo"
    elif vendor.lower() in ("asustek computer inc.", "asus"):
        vendor_norm = "ASUS"
    elif vendor.lower() in ("hewlett-packard", "hp"):
        vendor_norm = "HP"
    elif vendor.lower() in ("valve", "valve corporation"):
        vendor_norm = "Valve"
    elif vendor.lower() in ("framework", "framework computer inc."):
        vendor_norm = "Framework"

    if vendor_norm == "Valve" and name.lower() in ("jupiter", "galileo"):
        return f"Valve {name} (Steam Deck)"

    if vendor_norm == "Lenovo" and version and "thinkpad" in version.lower():
        primary = version
    elif name:
        primary = name
    elif version:
        primary = version
    else:
        primary = ""

    if primary:
        if vendor_norm and not primary.lower().startswith(vendor_norm.lower()):
            return f"{vendor_norm} {primary}".strip()
        return primary

    try:
        host = socket.gethostname().strip()
        if host and host.lower() not in ("localhost", "linux"):
            return f"Linux ({host})"
    except Exception:
        pass
    return "Linux Desktop"


def _run_cmd(args: List[str], timeout_sec: float = 0.8) -> str:
    if not args or not shutil.which(args[0]):
        return ""
    try:
        proc = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
        return (proc.stdout or "").strip()
    except Exception:
        return ""


def detect_active_window_linux() -> Dict[str, Any]:
    """
    Supports both X11 (xprop) and Wayland (swaymsg / hyprctl / gdbus / playerctl MPRIS)
    to identify the active application, window title, and whether short-form video is active.
    """
    app_name = "Linux Desktop"
    window_title = ""
    is_fullscreen = False
    session_type = os.environ.get("XDG_SESSION_TYPE", "").lower()

    # 1. Try X11 xprop if DISPLAY is available
    if os.environ.get("DISPLAY") and session_type != "wayland":
        root_out = _run_cmd(["xprop", "-root", "_NET_ACTIVE_WINDOW"])
        if "0x" in root_out:
            win_id = root_out.split()[-1]
            if win_id and win_id != "0x0":
                wm_class_out = _run_cmd(["xprop", "-id", win_id, "WM_CLASS"])
                wm_name_out = _run_cmd(["xprop", "-id", win_id, "_NET_WM_NAME"])
                wm_state_out = _run_cmd(["xprop", "-id", win_id, "_NET_WM_STATE"])
                if "_NET_WM_STATE_FULLSCREEN" in wm_state_out:
                    is_fullscreen = True
                if '"' in wm_class_out:
                    parts = [p for p in wm_class_out.split('"') if p.strip()]
                    if parts:
                        app_name = parts[-1].strip()
                if '"' in wm_name_out:
                    first_q = wm_name_out.find('"')
                    last_q = wm_name_out.rfind('"')
                    if last_q > first_q:
                        window_title = wm_name_out[first_q + 1 : last_q]

    # 2. Wayland compositors (Sway / Hyprland / GNOME gdbus) & MPRIS fallback
    if app_name == "Linux Desktop" and not window_title:
        hypr_out = _run_cmd(["hyprctl", "activewindow", "-j"])
        if hypr_out.startswith("{"):
            try:
                h_obj = json.loads(hypr_out)
                app_name = str(h_obj.get("class") or h_obj.get("initialClass") or app_name)
                window_title = str(h_obj.get("title") or "")
                is_fullscreen = bool(h_obj.get("fullscreen"))
            except Exception:
                pass

    if app_name == "Linux Desktop" and not window_title:
        sway_out = _run_cmd(["swaymsg", "-t", "get_tree"])
        if sway_out.startswith("{"):
            try:
                tree_obj = json.loads(sway_out)
                def _find_focused(node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
                    if node.get("focused") is True:
                        return node
                    for child in (node.get("nodes") or []) + (node.get("floating_nodes") or []):
                        if isinstance(child, dict):
                            found = _find_focused(child)
                            if found:
                                return found
                    return None
                focused_node = _find_focused(tree_obj)
                if focused_node:
                    win_props = focused_node.get("window_properties") or {}
                    app_name = str(
                        focused_node.get("app_id")
                        or win_props.get("class")
                        or win_props.get("instance")
                        or focused_node.get("name")
                        or "Wayland Window"
                    )
                    window_title = str(focused_node.get("name") or win_props.get("title") or "")
                    is_fullscreen = bool(focused_node.get("fullscreen_mode"))
            except Exception:
                pass

    if not window_title and os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        gdbus_out = _run_cmd(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.gnome.Shell",
                "--object-path",
                "/org/gnome/Shell",
                "--method",
                "org.gnome.Shell.Eval",
                "global.display.focus_window ? global.display.focus_window.get_wm_class() : ''",
            ]
        )
        if "true" in gdbus_out and '"' in gdbus_out:
            parts = [p for p in gdbus_out.split('"') if p.strip()]
            if len(parts) >= 2:
                app_name = parts[-1].strip("'")

    # 3. Check playerctl MPRIS metadata for active media/short-form title
    mpris_title = _run_cmd(["playerctl", "metadata", "title"])
    mpris_player = _run_cmd(["playerctl", "metadata", "--format", "{{playerName}}"])
    if mpris_title and not window_title:
        window_title = mpris_title
    if mpris_player and app_name == "Linux Desktop":
        app_name = mpris_player

    desktop_meta = resolve_linux_desktop_app_identity(app_name)
    display_app_name = desktop_meta.get("appName") or app_name
    icon_data_uri = desktop_meta.get("iconDataUri")

    lower_combined = f"{app_name} {display_app_name} {window_title}".lower()
    is_short_form = any(
        token in lower_combined
        for token in (
            "#shorts",
            "youtube shorts",
            "instagram reels",
            "tiktok",
            "/reels",
            "/shorts/",
            "x.com/i/immersive_timeline",
            "reddit.com/watch",
            "reddit watch",
            "snapchat spotlight",
            "/spotlight",
        )
    )
    content_type = None
    if is_short_form:
        if "short" in lower_combined:
            content_type = "SHORT"
        elif "tiktok" in lower_combined:
            content_type = "TIKTOK"
        else:
            content_type = "REEL"

    return {
        "foregroundProcessName": app_name,
        "foregroundAppDisplayName": display_app_name,
        "iconDataUri": icon_data_uri,
        "isNativeOsLabel": True,
        "foregroundWindowTitle": window_title,
        "isShortFormActive": is_short_form,
        "isFullscreenAppActive": is_fullscreen,
        "contentType": content_type,
    }


def detect_idle_seconds_linux() -> float:
    """
    Queries xprintidle (milliseconds) or org.gnome.Mutter.IdleMonitor D-Bus for user idle time.
    """
    if os.environ.get("DISPLAY"):
        xidle = _run_cmd(["xprintidle"])
        if xidle.isdigit():
            return round(int(xidle) / 1000.0, 1)
        xss_idle = _run_cmd(["xssstate", "-i"])
        if xss_idle.isdigit():
            return round(int(xss_idle) / 1000.0, 1)

    if os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        mutter_out = _run_cmd(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.gnome.Mutter.IdleMonitor",
                "--object-path",
                "/org/gnome/Mutter/IdleMonitor/Core",
                "--method",
                "org.gnome.Mutter.IdleMonitor.GetIdletime",
            ]
        )
        if "uint64" in mutter_out:
            for tok in mutter_out.replace("(", " ").replace(")", " ").replace(",", " ").split():
                if tok.isdigit():
                    return round(int(tok) / 1000.0, 1)
    loginctl_out = _run_cmd(["loginctl", "show-session", "auto", "-p", "IdleHint", "-p", "IdleSinceHintMonotonicUSec"])
    if "IdleHint=yes" in loginctl_out:
        return 305.0
    return 0.0


def detect_audio_spl_linux() -> Dict[str, Any]:
    """
    Inspects PipeWire (wpctl) or PulseAudio (pactl) default sink volume and active Corked: no / running streams.
    Only reports isAudioCurrentlyPlaying = True when an active uncorked audio stream is actually playing.
    """
    volume_scalar = 0.5
    is_muted = False
    has_active_stream = False
    audio_source_app = ""

    wp_out = _run_cmd(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    if "Volume:" in wp_out:
        try:
            parts = wp_out.split()
            for p in parts:
                if p.replace(".", "", 1).isdigit():
                    volume_scalar = max(0.0, min(1.0, float(p)))
                    break
            is_muted = "[MUTED]" in wp_out
        except Exception:
            pass
    else:
        pactl_out = _run_cmd(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
        if "%" in pactl_out:
            for tok in pactl_out.split():
                if tok.endswith("%") and tok[:-1].isdigit():
                    volume_scalar = max(0.0, min(1.0, int(tok[:-1]) / 100.0))
                    break

    sink_inputs_out = _run_cmd(["pactl", "list", "sink-inputs"])
    if sink_inputs_out:
        current_corked = True
        for line in sink_inputs_out.splitlines():
            stripped = line.strip()
            if stripped.startswith("Sink Input #"):
                current_corked = True
            elif stripped.startswith("Corked:"):
                current_corked = "no" not in stripped.lower()
                if not current_corked:
                    has_active_stream = True
            elif not current_corked and ("application.process.binary" in stripped or "application.name" in stripped):
                if "=" in stripped:
                    val = stripped.split("=", 1)[1].strip().strip('"')
                    if val and not audio_source_app:
                        audio_source_app = val

    if not has_active_stream:
        mpris_status = _run_cmd(["playerctl", "status"])
        if mpris_status.strip().lower() == "playing":
            has_active_stream = True
            mpris_player = _run_cmd(["playerctl", "-l"]).splitlines()
            if mpris_player:
                audio_source_app = mpris_player[0].split(".")[0].strip()

    is_playing = bool(has_active_stream and not is_muted and volume_scalar > 0.01)
    estimated_spl = round(50.0 + (volume_scalar * 45.0), 1) if is_playing else 40.0
    return {
        "isAudioCurrentlyPlaying": is_playing,
        "audioSourceAppKey": audio_source_app,
        "audioVolumeScalar": round(volume_scalar, 4),
        "audioMasterPeakValue": round(volume_scalar if is_playing else 0.0, 4),
        "estimatedSplDb": estimated_spl,
        "audioDeviceName": "Linux PipeWire/PulseAudio Sink",
        "audioDeviceType": "Speakers",
    }


def get_linux_device_identity() -> Dict[str, str]:
    marketing_name = resolve_linux_hardware_marketing_name()
    machine_id = _read_text_safe(pathlib.Path("/etc/machine-id")) or socket.gethostname() or "linux_host"
    hash_suffix = hashlib.sha256(machine_id.encode("utf-8")).hexdigest()[:8]
    return {
        "installationId": f"inst_linux_{hash_suffix}",
        "installationKey": f"linux_{hash_suffix}",
        "key": f"linux_{hash_suffix}",
        "deviceName": marketing_name,
        "marketingName": marketing_name,
        "model": marketing_name,
        "osCategory": "Linux",
        "deviceCategory": "Laptop",
        "osVersion": "Linux",
        "cutoutType": "FULLSCREEN",
    }


def detect_linux_store_channel(default_channel: str = "standalone") -> str:
    env_override = os.environ.get("SCREENSYNC_STORE_CHANNEL", "").strip()
    if env_override:
        return env_override
    if os.environ.get("FLATPAK_ID"):
        return "flathub"
    if os.environ.get("SNAP"):
        return "snap"
    return default_channel




# Part 15 Task 15.8 — Linux Companion Anti-Trace (TracerPid), LD_PRELOAD Guard, 0o600 Secret Storage & HMAC State Verification
def inspect_linux_tracer_pid(status_path: str = "/proc/self/status") -> int:
    try:
        p = pathlib.Path(status_path)
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith("TracerPid:"):
                    val = line.split(":", 1)[1].strip()
                    return int(val) if val.isdigit() else 0
    except Exception:
        pass
    return 0


def check_linux_companion_security_integrity() -> Dict[str, Any]:
    tracer_pid = inspect_linux_tracer_pid()
    ld_preload = (os.environ.get("LD_PRELOAD") or "").strip()
    python_inspect = (os.environ.get("PYTHONINSPECT") or "").strip()
    flags: List[str] = []
    if tracer_pid != 0:
        flags.append(f"TRACER_PID_NON_ZERO:{tracer_pid}")
    if ld_preload:
        flags.append(f"LD_PRELOAD_DETECTED:{ld_preload}")
    if python_inspect:
        flags.append("PYTHONINSPECT_DETECTED")
    compromised = len(flags) > 0
    return {
        "ok": not compromised,
        "platform": "Linux",
        "status": "TAMPER_DETECTED" if compromised else "VERIFIED_CLEAN",
        "compromised": compromised,
        "tracerPid": tracer_pid,
        "ldPreloadDetected": bool(ld_preload),
        "pythonInspectDetected": bool(python_inspect),
        "tamperFlags": flags,
        "bytecodeReleaseCommand": "python3 -OO -m py_compile screensync_linux_companion.py",
        "checkedAtMs": int(time.time() * 1000),
    }


def enforce_secure_file_permissions(file_path: pathlib.Path) -> bool:
    try:
        if file_path.exists():
            os.chmod(str(file_path), 0o600)
            return True
    except Exception:
        pass
    return False


def compute_state_hmac_sha256(payload_json: str, secret_key: str) -> str:
    key_bytes = (secret_key or "screensync_linux_local_hmac_v1").encode("utf-8")
    return hmac.new(key_bytes, (payload_json or "").encode("utf-8"), hashlib.sha256).hexdigest()


def verify_state_hmac_sha256(payload_json: str, expected_mac: str, secret_key: str) -> bool:
    if not expected_mac:
        return False
    actual = compute_state_hmac_sha256(payload_json, secret_key)
    return hmac.compare_digest(actual, expected_mac)


class ScreenSyncLinuxCompanionServer:
    def __init__(self, port: int = DEFAULT_PORT, store_channel: str = ""):
        self.port = port
        self.store_channel = store_channel or detect_linux_store_channel()
        self.device_identity = get_linux_device_identity()
        self.pending_ticks: List[Dict[str, Any]] = []
        self._lock = threading.RLock()
        self._running = False
        self._was_locked = False
        self._seq = 0
        self._security_state = check_linux_companion_security_integrity()
        self._db_path = pathlib.Path.home() / ".local" / "share" / "screensync" / "companion_wal.db"
        self._token_path = pathlib.Path.home() / ".local" / "share" / "screensync" / "companion_token.json"
        self._init_sqlite_wal()
        enforce_secure_file_permissions(self._db_path)

    def _init_sqlite_wal(self) -> None:
        try:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(str(self._db_path)) as conn:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS pending_ticks (id INTEGER PRIMARY KEY AUTOINCREMENT, check_time_ms INTEGER, payload_json TEXT NOT NULL);"
                )
                rows = conn.execute("SELECT payload_json FROM pending_ticks ORDER BY id ASC LIMIT 240;").fetchall()
                for (raw_json,) in rows:
                    try:
                        self.pending_ticks.append(json.loads(raw_json))
                    except Exception:
                        pass
        except Exception:
            pass

    def _persist_tick_wal(self, tick: Dict[str, Any]) -> None:
        try:
            with sqlite3.connect(str(self._db_path)) as conn:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute(
                    "INSERT INTO pending_ticks (check_time_ms, payload_json) VALUES (?, ?);",
                    (int(tick.get("checkTimeMs") or 0), json.dumps(tick)),
                )
        except Exception:
            pass

    def _clear_persisted_ticks_wal(self) -> None:
        try:
            with sqlite3.connect(str(self._db_path)) as conn:
                conn.execute("DELETE FROM pending_ticks;")
        except Exception:
            pass

    def _check_session_locked(self) -> bool:
        out = _run_cmd(["loginctl", "show-session", "auto", "-p", "LockedHint", "--value"])
        return out.strip().lower() == "yes"

    def collect_tick(self) -> Dict[str, Any]:
        is_locked = self._check_session_locked()
        now_ms = int(time.time() * 1000)
        if is_locked != self._was_locked:
            self._was_locked = is_locked
            lifecycle_tick = {
                "installationId": self.device_identity["installationId"],
                "installationKey": self.device_identity["installationKey"],
                "deviceName": self.device_identity["deviceName"],
                "marketingName": self.device_identity["marketingName"],
                "osCategory": "Linux",
                "deviceCategory": "Laptop",
                "lifecycleAction": "PAUSE_LOCK" if is_locked else "RESUME_UNLOCK",
                "isSessionLocked": is_locked,
                "checkTimeMs": now_ms,
            }
            with self._lock:
                self.pending_ticks.append(lifecycle_tick)
                self._persist_tick_wal(lifecycle_tick)
            if is_locked:
                return lifecycle_tick

        win = detect_active_window_linux()
        idle_secs = detect_idle_seconds_linux()
        audio = detect_audio_spl_linux()
        is_fullscreen = bool(win.get("isFullscreenAppActive", False))
        if not is_fullscreen and os.environ.get("DISPLAY"):
            root_out = _run_cmd(["xprop", "-root", "_NET_ACTIVE_WINDOW"])
            if "0x" in root_out:
                win_id = root_out.split()[-1]
                if win_id and win_id != "0x0":
                    state_out = _run_cmd(["xprop", "-id", win_id, "_NET_WM_STATE"])
                    is_fullscreen = "_NET_WM_STATE_FULLSCREEN" in state_out
        self._seq += 1
        tick = {
            "installationId": self.device_identity["installationId"],
            "installationKey": self.device_identity["installationKey"],
            "deviceName": self.device_identity["deviceName"],
            "marketingName": self.device_identity["marketingName"],
            "osCategory": "Linux",
            "deviceCategory": "Laptop",
            "storeChannel": self.store_channel,
            "foregroundProcessName": win["foregroundProcessName"],
            "foregroundAppDisplayName": win["foregroundAppDisplayName"],
            "iconDataUri": win.get("iconDataUri"),
            "isNativeOsLabel": True,
            "foregroundWindowTitle": win["foregroundWindowTitle"],
            "isShortFormActive": win["isShortFormActive"],
            "contentType": win["contentType"],
            "idleSeconds": idle_secs,
            "isFullscreenAppActive": is_fullscreen,
            "sequence": self._seq,
            **audio,
            "checkTimeMs": now_ms,
        }
        with self._lock:
            self.pending_ticks.append(tick)
            self._persist_tick_wal(tick)
            if len(self.pending_ticks) > 240:
                self.pending_ticks = self.pending_ticks[-240:]
        return tick

    def build_poll_response(self) -> Dict[str, Any]:
        with self._lock:
            if not self.pending_ticks:
                self.collect_tick()
            ticks = list(self.pending_ticks)
            self.pending_ticks.clear()
            self._clear_persisted_ticks_wal()
        return {
            "ok": True,
            "platform": "Linux",
            "osCategory": "Linux",
            "storeChannel": self.store_channel,
            "installationId": self.device_identity["installationId"],
            "installationKey": self.device_identity["installationKey"],
            "deviceName": self.device_identity["deviceName"],
            "marketingName": self.device_identity["marketingName"],
            "ticks": ticks,
        }

    def build_device_response(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "platform": "Linux",
            "osCategory": "Linux",
            "marketingName": self.device_identity["marketingName"],
            "device": self.device_identity,
        }

    def build_installed_apps_response(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "platform": "Linux",
            "osCategory": "Linux",
            "apps": discover_installed_linux_applications(),
        }

    def build_store_status_response(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "platform": "Linux",
            "storeChannel": self.store_channel,
            "isSessionLocked": False,
            "marketingName": self.device_identity["marketingName"],
            "version": COMPANION_VERSION,
        }

    def run_forever(self) -> None:
        companion = self

        class CompanionRequestHandler(http.server.BaseHTTPRequestHandler):
            def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
                raw = json.dumps(payload).encode("utf-8")
                self.send_response(status_code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                req_origin = self.headers.get("Origin", "")
                allowed_origin = req_origin if (not req_origin or req_origin.startswith(("http://127.0.0.1", "http://localhost", "capacitor://localhost", "chrome-extension://"))) else "http://127.0.0.1:3001"
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ScreenSync-Token")
                self.end_headers()
                self.wfile.write(raw)

            def do_OPTIONS(self) -> None:
                req_origin = self.headers.get("Origin", "")
                allowed_origin = req_origin if (not req_origin or req_origin.startswith(("http://127.0.0.1", "http://localhost", "capacitor://localhost", "chrome-extension://"))) else "http://127.0.0.1:3001"
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ScreenSync-Token")
                self.end_headers()

            def do_GET(self) -> None:
                if self.path.startswith("/api/v1/security/attest") or self.path.startswith("/api/companion/security-attest"):
                    self._send_json(200, check_linux_companion_security_integrity())
                elif self.path.startswith("/api/companion/device"):
                    self._send_json(200, companion.build_device_response())
                elif self.path.startswith("/api/companion/installed-apps"):
                    self._send_json(200, companion.build_installed_apps_response())
                elif self.path.startswith("/api/companion/store-status"):
                    self._send_json(200, companion.build_store_status_response())
                elif self.path.startswith("/api/companion/history"):
                    self._send_json(200, {"ok": True, "platform": "Linux", "osCategory": "Linux", "daysBack": 30, "days": []})
                else:
                    self._send_json(200, companion.build_poll_response())

            def log_message(self, format: str, *args: Any) -> None:
                return

        self._running = True
        def _bg_collector_loop() -> None:
            while self._running:
                try:
                    self.collect_tick()
                except Exception:
                    pass
                time.sleep(10.0)
        bg_thread = threading.Thread(target=_bg_collector_loop, name="screensync-linux-collector", daemon=True)
        bg_thread.start()
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), CompanionRequestHandler)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            self._running = False
            httpd.server_close()


if __name__ == "__main__":
    port_num = int(os.environ.get("SCREENSYNC_COMPANION_PORT", str(DEFAULT_PORT)))
    channel = os.environ.get("SCREENSYNC_STORE_CHANNEL", "flathub")
    server = ScreenSyncLinuxCompanionServer(port=port_num, store_channel=channel)
    server.run_forever()
