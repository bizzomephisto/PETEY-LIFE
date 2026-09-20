"""Original PETEY Life simulation add-on."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import random
import re
import threading
import time

from flask import jsonify, request

from petey.ai_provider import AIProvider, AIProviderError


MAX_OBJECTS = 80
MAX_EVENTS = 24
ALLOWED_KINDS = {
    "bed", "bookshelf", "chair", "coffee", "computer", "counter", "lamp",
    "plant", "rug", "sofa", "table", "television",
}
ALLOWED_ACTIONS = {"walk_to", "interact", "rest", "speak", "wait"}


def _default_world() -> dict:
    return {
        "version": 1,
        "cols": 20,
        "rows": 14,
        "petey": {"col": 9, "row": 8, "activity": "Looking around", "say": ""},
        "objects": [
            {"id": "bed", "kind": "bed", "label": "Bed", "col": 1, "row": 1, "w": 4, "h": 2, "color": "#67507c"},
            {"id": "bookshelf", "kind": "bookshelf", "label": "Bookshelf", "col": 6, "row": 1, "w": 2, "h": 1, "color": "#8b5f3d"},
            {"id": "computer", "kind": "computer", "label": "Computer", "col": 15, "row": 2, "w": 2, "h": 2, "color": "#4f7693"},
            {"id": "coffee", "kind": "coffee", "label": "Coffee maker", "col": 10, "row": 2, "w": 1, "h": 1, "color": "#a67145"},
            {"id": "counter", "kind": "counter", "label": "Kitchen counter", "col": 9, "row": 1, "w": 4, "h": 1, "color": "#806f65"},
            {"id": "sofa", "kind": "sofa", "label": "Sofa", "col": 3, "row": 9, "w": 4, "h": 2, "color": "#3f786b"},
            {"id": "television", "kind": "television", "label": "Television", "col": 3, "row": 12, "w": 3, "h": 1, "color": "#39445c"},
            {"id": "table", "kind": "table", "label": "Table", "col": 11, "row": 8, "w": 3, "h": 2, "color": "#895b3f"},
            {"id": "plant", "kind": "plant", "label": "Plant", "col": 17, "row": 10, "w": 1, "h": 1, "color": "#4e8b58"},
        ],
        "events": [],
        "settings": {"autonomy": False, "interval": 45},
    }


def _bounded_text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _bounded_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


class PeteyLifeAddon:
    def __init__(self, context):
        self.context = context
        self.data_dir = Path(context.data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / "world.json"
        self._lock = threading.RLock()
        self._world = self._load()

    def _load(self) -> dict:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return self._validate_world(value)
        except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
            return _default_world()

    def _write(self) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self._world, indent=2), encoding="utf-8")
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        temporary.replace(self.path)

    @staticmethod
    def _validate_world(value) -> dict:
        if not isinstance(value, dict):
            raise ValueError("World must be an object.")
        cols = _bounded_int(value.get("cols"), 20, 10, 40)
        rows = _bounded_int(value.get("rows"), 14, 8, 30)
        objects = []
        seen = set()
        for raw in list(value.get("objects") or [])[:MAX_OBJECTS]:
            if not isinstance(raw, dict):
                continue
            object_id = re.sub(r"[^a-z0-9_-]", "", str(raw.get("id") or "").lower())[:48]
            kind = str(raw.get("kind") or "").lower()
            if not object_id or object_id in seen or kind not in ALLOWED_KINDS:
                continue
            seen.add(object_id)
            w = _bounded_int(raw.get("w"), 1, 1, 5)
            h = _bounded_int(raw.get("h"), 1, 1, 4)
            col = _bounded_int(raw.get("col"), 0, 0, cols - w)
            row = _bounded_int(raw.get("row"), 0, 0, rows - h)
            color = str(raw.get("color") or "#667085")
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                color = "#667085"
            objects.append({
                "id": object_id, "kind": kind,
                "label": _bounded_text(raw.get("label") or kind.title(), 60),
                "col": col, "row": row, "w": w, "h": h, "color": color,
            })
        petey = dict(value.get("petey") or {})
        settings = dict(value.get("settings") or {})
        return {
            "version": 1, "cols": cols, "rows": rows,
            "petey": {
                "col": _bounded_int(petey.get("col"), cols // 2, 0, cols - 1),
                "row": _bounded_int(petey.get("row"), rows // 2, 0, rows - 1),
                "activity": _bounded_text(petey.get("activity") or "Looking around", 120),
                "say": _bounded_text(petey.get("say"), 240),
            },
            "objects": objects,
            "events": [
                {"at": int(item.get("at", 0)), "text": _bounded_text(item.get("text"), 240)}
                for item in list(value.get("events") or [])[-MAX_EVENTS:]
                if isinstance(item, dict) and _bounded_text(item.get("text"), 240)
            ],
            "settings": {
                "autonomy": settings.get("autonomy") is True,
                "interval": _bounded_int(settings.get("interval"), 45, 15, 300),
            },
        }

    def public_state(self) -> dict:
        with self._lock:
            world = copy.deepcopy(self._world)
        persona = self.context.state.persona
        return {
            "world": world,
            "petey": {
                "name": _bounded_text(persona.get("name") or "Petey", 80),
                "role": _bounded_text(persona.get("role_tag") or "Companion", 80),
                "traits": [_bounded_text(item, 40) for item in persona.get("traits", [])[:8]],
            },
            "object_kinds": sorted(ALLOWED_KINDS),
        }

    def update_world(self, payload) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("World update must be an object.")
        with self._lock:
            merged = copy.deepcopy(self._world)
            for key in ("cols", "rows", "petey", "objects", "events", "settings"):
                if key in payload:
                    merged[key] = payload[key]
            self._world = self._validate_world(merged)
            self._write()
        return self.public_state()

    def update_settings(self, payload) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("Settings must be an object.")
        with self._lock:
            settings = dict(self._world["settings"])
            if "autonomy" in payload:
                if type(payload["autonomy"]) is not bool:
                    raise ValueError("Autonomy must be true or false.")
                settings["autonomy"] = payload["autonomy"]
            if "interval" in payload:
                settings["interval"] = _bounded_int(payload["interval"], 45, 15, 300)
            self._world["settings"] = settings
            self._write()
        return self.public_state()

    def _fallback_decision(self, command: str) -> dict:
        objects = self._world["objects"]
        if command:
            lowered = command.casefold()
            target = next((item for item in objects if item["label"].casefold() in lowered), None)
            if target is None:
                target = next((item for item in objects if item["kind"] in lowered), None)
            if target:
                return {
                    "action": "interact", "target": target["id"],
                    "activity": f"Using {target['label'].lower()}",
                    "say": "All right.", "duration": 8,
                }
            return {"action": "speak", "target": "", "activity": "Talking with you", "say": "I heard you.", "duration": 5}
        target = random.choice(objects) if objects else None
        if target:
            return {"action": "interact", "target": target["id"], "activity": f"Checking out {target['label'].lower()}", "say": "", "duration": 8}
        return {"action": "wait", "target": "", "activity": "Daydreaming", "say": "", "duration": 8}

    def decide(self, payload) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("Decision request must be an object.")
        command = _bounded_text(payload.get("command"), 500)
        visible = payload.get("visible") is True
        if not command and not visible:
            raise ValueError("Autonomous decisions require an open Petey Life view.")
        with self._lock:
            snapshot = copy.deepcopy(self._world)
        object_summary = [
            {"id": item["id"], "kind": item["kind"], "label": item["label"]}
            for item in snapshot["objects"]
        ]
        prompt = (
            "Choose Petey's next small action inside his pixel house. "
            "Return only one JSON object with keys action, target, activity, say, duration. "
            f"action must be one of {sorted(ALLOWED_ACTIONS)}. target must be an object id or empty. "
            "duration is 3 to 30 seconds. Keep say under 120 characters. "
            f"Objects: {json.dumps(object_summary)}. Current activity: {snapshot['petey']['activity']}. "
            f"User direction: {command or 'None; choose naturally based on Petey personality.'}"
        )
        system = (
            self.context.state.system_prompt
            + "\n\nYou are directing your own actions in a cozy pixel-house simulation. "
              "Stay in character. Choose ordinary, concrete activities using only the supplied action schema."
        )
        try:
            raw = AIProvider(self.context.state.ai_provider).complete(prompt, system, [])
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if not match:
                raise ValueError("No decision object returned.")
            decision = json.loads(match.group(0))
            if not isinstance(decision, dict):
                raise ValueError("Decision was not an object.")
        except (AIProviderError, ValueError, json.JSONDecodeError):
            decision = self._fallback_decision(command)
        action = str(decision.get("action") or "wait")
        if action not in ALLOWED_ACTIONS:
            action = "wait"
        target = str(decision.get("target") or "")
        object_ids = {item["id"] for item in snapshot["objects"]}
        if target not in object_ids:
            target = ""
        result = {
            "action": action,
            "target": target,
            "activity": _bounded_text(decision.get("activity") or "Taking it easy", 120),
            "say": _bounded_text(decision.get("say"), 120),
            "duration": _bounded_int(decision.get("duration"), 8, 3, 30),
        }
        event_text = result["activity"] + (f" — “{result['say']}”" if result["say"] else "")
        with self._lock:
            self._world["petey"]["activity"] = result["activity"]
            self._world["petey"]["say"] = result["say"]
            self._world["events"].append({"at": int(time.time()), "text": event_text})
            self._world["events"] = self._world["events"][-MAX_EVENTS:]
            self._write()
        return {"decision": result, "state": self.public_state()}

    def close(self):
        return None


def setup(context):
    addon = PeteyLifeAddon(context)
    prefix = f"/api/addons/{context.addon_id}"
    endpoint = context.addon_id.replace("-", "_")

    def state_route():
        return jsonify(addon.public_state())

    def world_route():
        try:
            return jsonify(addon.update_world(request.get_json(silent=True) or {}))
        except (TypeError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400

    def settings_route():
        try:
            return jsonify(addon.update_settings(request.get_json(silent=True) or {}))
        except (TypeError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400

    def decision_route():
        try:
            return jsonify(addon.decide(request.get_json(silent=True) or {}))
        except (TypeError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400

    context.app.add_url_rule(f"{prefix}/state", f"addon_{endpoint}_state", state_route, methods=["GET"])
    context.app.add_url_rule(f"{prefix}/world", f"addon_{endpoint}_world", world_route, methods=["PUT"])
    context.app.add_url_rule(f"{prefix}/settings", f"addon_{endpoint}_settings", settings_route, methods=["PUT"])
    context.app.add_url_rule(f"{prefix}/decide", f"addon_{endpoint}_decide", decision_route, methods=["POST"])
    return addon
