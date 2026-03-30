# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MirrorFire streams an Android phone's screen to a DLNA-compatible TV over the local network. The phone browser captures the screen via `getDisplayMedia`, sends video chunks over WebSocket to a Node.js server, which re-serves them as a chunked HTTP stream that the TV consumes via DLNA/UPnP.

## Commands

- **Run:** `npm start` or `node server.js` (listens on port 82)
- **Docker:** `docker compose up -d --build` (uses host networking for SSDP multicast)
- **Stop:** `docker compose down`

There is no test suite, linter, or build step configured.

## Architecture

The entire backend is in `server.js` and the frontend is a single file at `public/index.html` (inline CSS/JS, no framework). Only two dependencies: `express` and `ws`.

### Data Flow

1. Phone browser → `GET /api/discover-tvs` → server sends SSDP M-SEARCH multicast → returns discovered TVs
2. Phone captures screen via `getDisplayMedia`, creates `MediaRecorder`, opens WebSocket to server
3. Phone → `POST /api/start-cast` → server sends DLNA SOAP commands (`SetAVTransportURI` + `Play`) pointing TV at `GET /stream/:id`
4. MediaRecorder binary chunks flow: Phone → WebSocket → server → chunked HTTP response → TV

### Key Design Decisions

- **Single-process monolith:** Express HTTP server and WebSocket server share port 82 on the same `http.Server` instance.
- **Global mutable state:** One active stream at a time, stored in a module-level `activeStream` variable. No multi-session support.
- **Rolling buffer:** Server keeps ~60 most recent media chunks in memory. New TV connections receive buffered chunks first, then live data. Buffer caps at 120 entries, pruned to 60.
- **Hand-rolled DLNA/UPnP:** SSDP discovery and SOAP commands implemented with raw UDP (`dgram`) and `fetch` — no DLNA library. XML parsed via regex.
- **Codec negotiation:** Frontend tries H.264 (MP4) first for TV compatibility, falls back through WebM/VP8/VP9 variants.
- **Host networking required:** Docker runs with `network_mode: host` because SSDP multicast needs direct LAN access.
- **HTTPS via reverse proxy:** The Screen Capture API requires a secure context. The app itself is HTTP-only; Nginx Proxy Manager provides TLS termination.
