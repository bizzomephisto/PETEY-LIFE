# Petey Life coding-agent context

Scope: this repository. Current add-on version: 0.1.0; PETEY add-on API: 1.
Read PETEY Desktop's `ADDONS.md` and `docs/addons.md` before changing host contracts.

## Product boundary

Petey Life is an original, dependency-free pixel room for PETEY's system-default
persona. Peek mode may request one bounded model decision while the panel is visible;
Direct mode interprets one user instruction; Build mode edits the room locally.
It does not read chat history or PETEY's memory database. No third-party code or art
is bundled.

## Architecture and state

- `petey-addon.json` declares ID `petey-life`, panel assets, navigation, and API 1.
- `addon.py:PeteyLifeAddon` validates the room, stores world state, constructs one
  provider prompt, validates the returned action, and supplies a local fallback.
- `_validate_world()` is the trust boundary for dimensions, objects, labels, journal,
  settings, and Petey position. Every loaded and updated world passes through it.
- `decide()` accepts only `walk_to`, `interact`, `rest`, `speak`, or `wait`; it
  validates targets, text, and duration before recording an activity.
- PETEY's configured `AIProvider` and `state.system_prompt` supply the decision and
  persona. Do not switch this to active desktop-chat history or a saved conversation.
- `panel.js` owns Canvas drawing, original pixel sprites, grid occupancy, breadth-first
  pathfinding, animation, editing gestures, and the visibility-aware autonomy timer.
- `panel.html` and `panel.css` provide the responsive sidebar/mobile UI.
- State is written atomically to `addon-data/petey-life/world.json`; source files stay
  immutable at runtime.

## Preserve these contracts

- Autonomy defaults off, runs only while the Life panel and document are visible,
  and waits the configured interval between provider requests.
- One activity equals at most one provider request. Invalid JSON, unknown actions,
  missing objects, or out-of-range values fall back to a safe local action.
- Keep world dimensions, object count, labels, journal length, prompt size, and action
  duration bounded. Never evaluate model output as code or HTML.
- Build-mode labels may inform the action planner but must enter the DOM via
  `textContent` and remain bounded.
- Preserve passable grid cells and pathfinding termination when adding furniture.
- The system-default persona is deliberate: Petey Life does not follow a selected
  saved chat's persona slot.
- `close()` remains safe and idempotent. Disabled discovery performs no provider call.

## Task map

| Task | Primary anchors |
| --- | --- |
| Defaults/load/save | `addon.py:DEFAULT_WORLD`, `_load`, `_write` |
| World validation | `_validate_world`, `update_world`, `update_settings` |
| AI activities | `decide`, `_fallback_decision` |
| API routes | `setup` and `/state`, `/world`, `/settings`, `/decide` |
| Rendering/editor/pathfinding | `panel.js` |
| Layout/theme | `panel.html`, `panel.css` |
| Regression coverage | `tests/test_addon.py` |

## Validation

```bash
PYTHONPATH=/path/to/PETEY-DESKTOP python -m unittest discover -s tests -v
python -m py_compile addon.py
python -m json.tool petey-addon.json >/dev/null
node --check panel.js
```

Tests must use temporary add-on data and mocked providers. They must not call paid
models or write to the user's PETEY data root. Browser changes also need a manual
Peek/Direct/Build smoke check at desktop and mobile widths.
