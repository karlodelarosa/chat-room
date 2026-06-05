# Chatroom

A lightweight real-time chat app with temporary rooms. No database, no authentication — just create a room, share the link, and chat.

**Live site:** [chat-room.pages.dev](https://chat-room.pages.dev)

## Tech Stack

- **Frontend:** React, Vite, TypeScript, React Router, emoji-picker-react
- **Backend:** Cloudflare Workers, Durable Objects, WebSockets

## Features

- Create temporary chat rooms with unique 8-character IDs
- Join instantly via shared URL (`/room/:roomId`)
- Real-time messaging with usernames and timestamps
- User presence (join/leave notifications, online count)
- Typing indicators
- Emoji picker
- Camera photo capture and sharing in chat
- Live video & voice calls (WebRTC peer-to-peer, WebSocket signaling)
- Copy room link button
- Random username generator
- Rooms deleted when the last user leaves
- Rooms expire after 24 hours of inactivity

## Local Development

From the project root:

```bash
npm install
npm run dev
```

This starts:

- **Cloudflare Worker** (API + WebSockets) on [http://localhost:8787](http://localhost:8787)
- **React client** on [http://localhost:5173](http://localhost:5173) (proxies `/api` to the worker)

Open [http://localhost:5173](http://localhost:5173), click **Create Room**, pick a username, and start chatting.

For the legacy Node.js server instead:

```bash
npm run dev:node
```

## Project Structure

```
chatroom/
├── client/          # React + Vite frontend
│   └── src/
├── worker/          # Cloudflare Worker + Durable Object
│   └── src/
├── server/          # Legacy Express + Socket.IO (local dev only)
├── wrangler.jsonc   # Cloudflare deployment config
└── package.json
```

## Deploy to Cloudflare Pages

Same pattern as [music-playground](https://music-playground.pages.dev): connect the GitHub repo to Cloudflare Pages. The project name `chat-room` gives you **chat-room.pages.dev**.

### Dashboard settings

| Setting | Value |
|---------|-------|
| **Production branch** | `main` |
| **Root directory** | *(leave blank)* |
| **Build command** | `npm install && npm run build && npx wrangler deploy` |
| **Build output directory** | *(leave blank — wrangler deploys the Worker + assets)* |

### Environment variables

None required.

Optional:

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_VERSION` | `20` | Use if the build fails on Node version |

### Deploy from CLI

```bash
npm run deploy
```

## How Chat Rooms Work

1. Each chat room maps to a Durable Object instance identified by `roomId`.
2. Clients connect via WebSocket at `/api/ws?roomId=...`.
3. Room state (users, messages) lives in the Durable Object — no external database.
4. When the last user disconnects, the room is cleared from memory.
5. A Durable Object alarm expires rooms inactive for 24+ hours.

## Production Build

```bash
npm run build
npm run deploy
```

The Worker serves the built React app from `client/dist` and handles WebSocket/API traffic on the same origin.
