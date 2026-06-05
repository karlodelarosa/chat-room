# Chatroom

A lightweight real-time chat app with temporary rooms. No database, no authentication — just create a room, share the link, and chat.

## Tech Stack

- **Frontend:** React, Vite, TypeScript, React Router, Socket.IO Client, emoji-picker-react
- **Backend:** Node.js, Express, Socket.IO

## Features

- Create temporary chat rooms with unique 8-character IDs
- Join instantly via shared URL (`/room/:roomId`)
- Real-time messaging with usernames and timestamps
- User presence (join/leave notifications, online count)
- Typing indicators
- Emoji picker
- Camera photo capture and sharing in chat
- Live video & voice calls (WebRTC peer-to-peer, Socket.IO signaling)
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

- **API / WebSocket server** on [http://localhost:3001](http://localhost:3001)
- **React client** on [http://localhost:5173](http://localhost:5173)

Open [http://localhost:5173](http://localhost:5173), click **Create Room**, pick a username, and start chatting. Open the room URL in another tab or browser to test multi-user chat.

Click **Start Video & Voice** to join a live call. Allow camera and microphone access. Other users in the room can join the same way and you'll see each other's video and hear each other in real time.

## Project Structure

```
chatroom/
├── client/          # React + Vite frontend
│   └── src/
│       ├── components/
│       ├── hooks/
│       ├── utils/
│       └── types.ts
├── server/          # Express + Socket.IO backend
│   └── src/
│       ├── index.ts # Socket.IO room logic
│       └── types.ts
└── package.json     # Root scripts (concurrently)
```

## How Socket.IO Rooms Work

1. Each chat room maps to a Socket.IO room channel identified by `roomId`.
2. When a user joins, the server calls `socket.join(roomId)` so broadcasts reach only that room.
3. Room state (users, messages) is stored in an in-memory `Map` — no persistence.
4. When the last user disconnects, the room is removed from memory.
5. A background job checks for rooms inactive for 24+ hours and expires them.

## Production Build

```bash
npm run build
npm start
```

Serve the `client/dist` static files from Express or a reverse proxy in production.
