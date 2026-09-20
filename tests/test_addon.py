from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from flask import Flask


ADDON_DIR = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("petey_life_test_addon", ADDON_DIR / "addon.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeState:
    persona = {"name": "Petey", "role_tag": "Companion", "traits": ["curious", "warm"]}
    system_prompt = "You are Petey. You like coffee and quiet mornings."
    ai_provider = {"provider": "gemini", "gemini": {"api_key": "test"}}


class PeteyLifeAddonTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        context = SimpleNamespace(
            app=self.app,
            addon_id="petey-life",
            data_dir=Path(self.temporary.name),
            state=FakeState(),
        )
        self.addon = MODULE.setup(context)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temporary.cleanup()

    def test_default_state_is_bounded_and_private_file_is_created_on_write(self):
        response = self.client.get("/api/addons/petey-life/state")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["world"]["cols"], 20)
        self.assertEqual(payload["petey"]["traits"], ["curious", "warm"])
        self.assertFalse(payload["world"]["settings"]["autonomy"])

        update = self.client.put("/api/addons/petey-life/settings", json={"autonomy": True, "interval": 1})
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.get_json()["world"]["settings"]["interval"], 15)
        self.assertTrue((Path(self.temporary.name) / "world.json").is_file())

    def test_autonomous_decision_requires_visible_panel(self):
        response = self.client.post("/api/addons/petey-life/decide", json={})
        self.assertEqual(response.status_code, 400)
        self.assertIn("open Petey Life view", response.get_json()["error"])

    def test_model_decision_is_validated_and_recorded(self):
        answer = json.dumps({
            "action": "interact", "target": "coffee", "activity": "Making coffee",
            "say": "Morning fuel.", "duration": 6,
        })
        with patch.object(MODULE.AIProvider, "complete", return_value=answer) as complete:
            response = self.client.post(
                "/api/addons/petey-life/decide",
                json={"command": "Make coffee", "visible": True},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["decision"]["target"], "coffee")
        self.assertEqual(payload["decision"]["activity"], "Making coffee")
        self.assertEqual(payload["state"]["world"]["events"][-1]["text"], "Making coffee — “Morning fuel.”")
        self.assertIn("cozy pixel-house", complete.call_args.args[1])

    def test_invalid_model_fields_fall_back_to_bounded_values(self):
        answer = json.dumps({"action": "teleport", "target": "missing", "duration": "forever"})
        with patch.object(MODULE.AIProvider, "complete", return_value=answer):
            response = self.client.post(
                "/api/addons/petey-life/decide",
                json={"command": "Surprise me", "visible": True},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["decision"]["action"], "wait")
        self.assertEqual(response.get_json()["decision"]["duration"], 8)

    def test_world_validation_clamps_layout_and_drops_unknown_objects(self):
        response = self.client.put("/api/addons/petey-life/world", json={
            "cols": 999,
            "rows": 2,
            "objects": [
                {"id": "safe-chair", "kind": "chair", "col": 999, "row": -4, "w": 9, "h": 9},
                {"id": "portal", "kind": "unknown", "col": 0, "row": 0},
            ],
        })
        self.assertEqual(response.status_code, 200)
        world = response.get_json()["world"]
        self.assertEqual((world["cols"], world["rows"]), (40, 8))
        self.assertEqual([item["id"] for item in world["objects"]], ["safe-chair"])
        self.assertEqual(world["objects"][0]["col"], 35)


if __name__ == "__main__":
    unittest.main()
