# API Reference

TermBeam exposes a REST API and WebSocket interface.

## REST API

All API endpoints (except `/login`, `/api/auth`, and `/api/version`) require authentication via cookie or Bearer token.

!!! note
Bearer authentication accepts the raw password in the `Authorization: Bearer <password>` header, not a session token.

### Authentication

#### `POST /api/auth`

Authenticate and receive a session token.

**Request:**

```json
{ "password": "your-password" }
```

**Response (200):**

```json
{ "ok": true }
```

Sets an httpOnly cookie `pty_token`.

**Response (401):**

```json
{ "error": "wrong password" }
```

**Response (429):**

```json
{ "error": "Too many attempts. Try again later." }
```

---

### Sessions

#### `GET /api/sessions`

List all active sessions.

**Response:**

```json
[
  {
    "id": "a1b2c3d4",
    "name": "my-project",
    "cwd": "/home/user/project",
    "shell": "/bin/zsh",
    "pid": 12345,
    "clients": 1,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

#### `POST /api/sessions`

Create a new session.

**Request:**

```json
{
  "name": "My Session",
  "shell": "/bin/bash",
  "args": ["-l"],
  "cwd": "/home/user",
  "initialCommand": "htop"
}
```

All fields are optional. If `initialCommand` is provided, it will be sent to the shell after startup.

**Response:**

```json
{
  "id": "e5f6g7h8",
  "url": "/terminal?id=e5f6g7h8"
}
```

#### `DELETE /api/sessions/:id`

Kill and remove a session.

**Response (200):**

```json
{ "ok": true }
```

**Response (404):**

```json
{ "error": "not found" }
```

#### `GET /api/shells`

List available shells on the host system.

**Response:**

```json
{
  "shells": [
    { "name": "bash", "path": "/bin/bash" },
    { "name": "zsh", "path": "/bin/zsh" }
  ],
  "default": "/bin/zsh"
}
```

---

### Utilities

#### `GET /api/version`

Get the server version.

**Response:**

```json
{ "version": "1.0.0" }
```

#### `GET /api/dirs?q=/path`

List subdirectories for the folder browser.

**Response:**

```json
{
  "base": "/home/user",
  "dirs": ["/home/user/projects", "/home/user/documents"]
}
```

---

## WebSocket API

Connect to `ws://host:port/ws`.

### Message Types (Client → Server)

#### Authenticate

If the server has a password set and the WebSocket connection wasn't authenticated via cookie, send an auth message first.

```json
{ "type": "auth", "password": "your-password" }
```

or with an existing token:

```json
{ "type": "auth", "token": "session-token" }
```

**Response:**

```json
{ "type": "auth_ok" }
```

#### Attach to Session

```json
{ "type": "attach", "sessionId": "a1b2c3d4" }
```

#### Send Input

```json
{ "type": "input", "data": "ls -la\r" }
```

#### Resize Terminal

```json
{ "type": "resize", "cols": 120, "rows": 30 }
```

### Message Types (Server → Client)

#### Terminal Output

```json
{ "type": "output", "data": "..." }
```

#### Attached Confirmation

```json
{ "type": "attached", "sessionId": "a1b2c3d4" }
```

#### Session Exited

```json
{ "type": "exit", "code": 0 }
```

#### Error

```json
{ "type": "error", "message": "Session not found" }
```
