# MirrorFire

Stream your Android phone screen to your TV via DLNA — no app needed on the TV.

## Prerequisites

- A Raspberry Pi (or any Linux host) with Docker installed
- [Nginx Proxy Manager](https://nginxproxymanager.com/) running on the same host
- A domain name pointed at your Raspberry Pi (for Let's Encrypt SSL)
- Your phone and TV on the same local network

## Installation

1. **Create a `docker-compose.yml` on your Raspberry Pi:**

   ```yaml
   services:
     mirrorfire:
       build: https://github.com/<your-repo>.git
       container_name: mirrorfire
       network_mode: host
       restart: unless-stopped
   ```

2. **Build and start the container:**

   ```bash
   docker compose up -d --build
   ```

   Docker pulls the repo and builds the image automatically. The app runs on port **82** with host networking (required for SSDP/DLNA multicast discovery).

3. **Configure Nginx Proxy Manager:**

   - Add a new **Proxy Host**
   - **Domain:** your domain (e.g. `cast.example.com`)
   - **Forward Hostname / IP:** `localhost`
   - **Forward Port:** `82`
   - **SSL tab:** Request a new Let's Encrypt certificate, enable "Force SSL"

4. **Open on your phone:**

   Navigate to `https://cast.example.com` in Chrome on your Android phone.

## Usage

1. Tap **Scan for TVs** — the app discovers DLNA-compatible TVs on your network
2. Select your TV
3. Tap **Start Casting** — Chrome will prompt you to share your screen
4. Your screen is streamed to the TV via DLNA

## Stopping

```bash
docker compose down
```

## Why HTTPS?

Chrome on Android requires a secure context (HTTPS) for the screen capture API (`getDisplayMedia`). Nginx Proxy Manager provides real SSL via Let's Encrypt, which satisfies this requirement.
