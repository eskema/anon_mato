# anon & mato

A hex-grid game where energy is time. You wake with a budget of minutes and
have to get home before it runs out. No win, no lose.

A nostr game — your key derives the world, and a save is a replayable log —
though most of the nostr primitives aren't wired up yet. soon™

Vanilla ES modules, Canvas2D, no build step. Pre-alpha.

## Run

```bash
bun run dev
```

http://127.0.0.1:4321

## Package

```bash
bun run napp
```

Builds `napp/` — the game and the playground's pages, nothing else — ready
for the nostrapps launcher's folder picker.

## Docs

[DESIGN.md](DESIGN.md) — what runs, and why.
[VISION.md](VISION.md) — where it's going. Mostly unbuilt.
