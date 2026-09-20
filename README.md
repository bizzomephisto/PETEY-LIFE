# Petey Life

[![PETEY Desktop](https://img.shields.io/badge/PETEY_Desktop-v0.18.2%2B-7f5af0)](https://github.com/bizzomephisto/PETEY-DESKTOP)
[![Release](https://img.shields.io/github/v/release/bizzomephisto/PETEY-LIFE)](https://github.com/bizzomephisto/PETEY-LIFE/releases/latest)
[![Tests](https://github.com/bizzomephisto/PETEY-LIFE/actions/workflows/test.yml/badge.svg)](https://github.com/bizzomephisto/PETEY-LIFE/actions/workflows/test.yml)

Give the active [PETEY Desktop](https://github.com/bizzomephisto/PETEY-DESKTOP) persona a small, editable pixel home. Watch Petey choose activities, direct him in plain English, or rebuild the room.

Petey Life is an original add-on with its own Canvas renderer, pixel artwork, room editor, and grid pathfinding. It has no third-party runtime dependencies, code, or art assets.

## Modes

- **Peek** — watch the current persona choose small activities. Autonomy is disabled by default, runs only while the panel is visible, and makes one chat-model request per activity.
- **Direct** — tell Petey what to do in natural language. The configured PETEY provider converts the instruction into a bounded room action.
- **Build** — place, name, select, and remove furniture. Custom labels such as “studio computer” or “reading chair” become available to Petey's action planner.

Supported actions are `walk_to`, `interact`, `rest`, `speak`, and `wait`. Every model response is validated. Invalid output falls back to a safe local choice.

## Requirements

- [PETEY Desktop v0.18.2 or newer](https://github.com/bizzomephisto/PETEY-DESKTOP/releases)
- A working PETEY chat provider for AI-directed activities

## Install

1. Download `petey-life-v0.1.0.zip` from the [latest release](https://github.com/bizzomephisto/PETEY-LIFE/releases/latest).
2. Extract the archive. It contains one folder named `petey-life`.
3. In PETEY, open **Add-ons** and select **Open add-ons folder**.
4. Copy the complete `petey-life` folder into that directory.
5. Return to PETEY, enable **Petey Life**, and restart PETEY.

For a source checkout, copy this repository's contents into a folder named `petey-life` under PETEY's add-ons directory.

## How Petey chooses

Petey Life supplies the active persona instructions, current activity, and available room objects to PETEY's configured chat provider. The provider returns one constrained JSON action. The backend validates the action, target, text, and duration before the panel uses it.

Petey Life does not read desktop chat history or PETEY's memory database. It uses the active persona prompt because that is what makes the simulated character the same Petey you configured.

Autonomy pauses when you leave the page or hide the browser tab. The selected interval is enforced between decisions. Direct commands make one model request when submitted.

## Storage and privacy

The room layout, activity journal, Petey's last position, and autonomy preference are stored under PETEY's private data root:

```text
addon-data/petey-life/world.json
```

No provider credentials are stored by this add-on. Provider calls use PETEY's existing configuration.

## Architecture

- `addon.py` validates and stores the world, exposes namespaced API routes, and asks PETEY's `AIProvider` for one bounded action.
- `panel.js` contains the Canvas renderer, breadth-first shortest-path search, animation, editor, and visibility-aware autonomy loop.
- `panel.html` and `panel.css` provide the responsive sidebar panel.

## Development

To test it beside a PETEY Desktop checkout:

```bash
PYTHONPATH=/path/to/PETEY-DESKTOP python -m unittest discover -s tests -v
```

The manifest targets PETEY add-on API version `1`. See PETEY's [add-on authoring contract](https://github.com/bizzomephisto/PETEY-DESKTOP/blob/main/docs/addons.md) for the host interface.
