# Claude Session Manager – eredeti specifikáció

Ez a dokumentum a projekt kiinduló specifikációja (2026-09-08). A megvalósítás döntéseit a README "How it works" része írja le.

## Cél

Egyszerű, mobilról is jól használható webalkalmazás, amely egy Xubuntu/Linux gépen futó Claude Code CLI sessionöket kezeli:

- futó Claude Code sessionök listázása
- új Claude Code session indítása
- meglévő sessionhöz csatlakozás
- a terminál teljes interaktív megjelenítése böngészőben
- Claude-dal való kommunikáció mobilról
- sessionök háttérben futtatása tmux segítségével

Saját használatra készül, nem multi-user alkalmazás.

## Alapelv

Ne legyen túlmérnökölve. Nem kell: adatbázis, felhasználókezelés, regisztráció, komplex jogosultságkezelés, cloud deployment, Kubernetes, Docker, komplex frontend framework. Egyetlen Linux gépen kell stabilan működnie. A sessionök állapotát a rendszerből (tmux) kell lekérdezni.

## Stack

Backend: Node.js, TypeScript, Fastify, WebSocket, node-pty, child_process, tmux.
Frontend: React + TypeScript, Vite, xterm.js, egyszerű CSS.

## Architektúra

```
Browser ── HTTP / WebSocket ──► Claude Session Manager (Node/TS) ── tmux / PTY ──► tmux ──► Claude #1..n
```

A webalkalmazás nem maga tartja életben a Claude processzt; a tmux session a tartós munkamenet. Böngésző bezárása, kapcsolatvesztés, újratöltés, WebSocket-megszakadás esetén a Claude Code tovább fut.

## tmux sessionök

Minden Claude Code munkamenet saját tmux sessiont kap (`claude-api`, `claude-shop`, ...).

```bash
tmux new-session -d -s claude-api -c /home/user/projects/api
tmux send-keys -t claude-api "claude" Enter
```

## Session discovery

A backend induláskor és minden lista-lekéréskor `tmux list-sessions` alapján ismeri fel a sessionöket, a kézzel létrehozottakat is.

## Session modell

```typescript
interface ClaudeSession {
  id: string;
  name: string;
  workingDirectory: string;
  status: "running" | "waiting" | "idle" | "stopped" | "error";
  createdAt?: string;
}
```

Első körben `running` / `stopped` elegendő; a finomabb státusz későbbi fejlesztés.

## REST API

- `GET /api/sessions` – összes kezelhető session
- `POST /api/sessions` – `{ name, workingDirectory }`: könyvtár validálása, tmux session létrehozása, Claude indítása, session adatainak visszaadása
- `DELETE /api/sessions/:id` – csak a tmux/Claude session leállítása, projektfájlokat nem töröl

## Terminál kapcsolat

xterm.js a böngészőben, WebSocket (`/ws/sessions/:sessionId`) a backendhez, a backend a tmux session termináljához csatlakozik. Kétirányú: billentyűzet → tmux, terminál output → böngésző. Támogatandó: karakterbevitel, Enter, Backspace, Ctrl+C, Ctrl+D, nyilak, ANSI escape sequence-ek, színek, resize (cols/rows küldése a backendnek).

## Frontend

Egyszerű, mobilbarát dashboard: session lista (név, könyvtár, státusz, OPEN), `New` gomb egy egyszerű formmal (Name, Working directory), session oldal teljes képernyős terminállal (← Sessions, név, státusz).

## Reconnect és history

WebSocket megszakadásnál a Claude és a tmux nem áll le; a frontend újracsatlakozik, és a tmux history utolsó 100–200 sora visszakerül, hogy ne üres terminált lásson a felhasználó. Nem kell a teljes történetet adatbázisban tárolni.

## Biztonság

Saját gépen, várhatóan Tailscale hálózaton fut. Ennek ellenére: tetszőleges shell parancs tiltása az API-n, session ID és working directory validálás, path traversal tiltása, nincs ellenőrizetlen input shell stringben, biztonságos process indítás. Első verzióban nem kell komplex auth, de legyen könnyen hozzáadható API key / jelszó védelem.

## Konfiguráció

```
PORT=3000
HOST=0.0.0.0
CLAUDE_COMMAND=claude
SESSION_PREFIX=claude-
ALLOWED_DIRECTORIES=/home/user/projects
```

## Logging

Session létrehozás, leállítás, WebSocket connect/disconnect, hibák. A teljes terminál outputot nem logoljuk.

## Process kezelés

Claude kilépése, tmux session megszűnése, WebSocket megszakadása, backend újraindítása: a backend újraindítása után a meglévő tmux sessionök megmaradnak, és az alkalmazás újra felfedezi őket.

## systemd és telepítés

`claude-session-manager.service`: boot után indul, hiba esetén újraindul, nem rootként fut. `./install.sh`: Node ellenőrzés, dependency install, frontend + backend build, systemd service telepítése, indítás. Frissítés: `git pull && ./deploy.sh`.

## MVP prioritás

1. tmux discovery
2. Session létrehozás
3. WebSocket terminal
4. Session lista (mobilbarát UI)
5. Reconnect
6. Session leállítás
7. systemd
8. Security hardening

## Későbbi fejlesztési lehetőségek (nem MVP)

Claude státusz (working / waiting / idle / error), session metadata (projekt, branch, model, indítás ideje), git információk, notification ha Claude inputra vár, rename, restart, favorite projects, több terminálablak egy sessionhöz, authentication, HTTPS.

## Definition of Done

1. Xubuntun elindul a backend.
2. A web UI megjeleníti a meglévő Claude/tmux sessionöket.
3. Web UI-ból létrehozható új session.
4. Az új sessionben elindul a Claude Code.
5. Böngészőből megnyitható a terminál.
6. A terminál interaktívan működik.
7. Mobilról is használható.
8. Böngésző bezárása nem állítja le Claude-ot.
9. Újracsatlakozás után ugyanabba a sessionbe vissza lehet térni.
10. Több Claude session párhuzamosan működik.
11. A backend újraindítása nem öli meg a tmux sessionöket.
12. systemd service-ként automatikusan indul.
13. A projekt rendelkezik README-vel és telepítési instrukciókkal.
