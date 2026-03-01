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
    "createdAt": "2025-01-01T00:00:00.000Z",
    "color": "#4a9eff",
    "lastActivity": 1719849600000
  }
]

| Field          | Type   | Description                                    |
| -------------- | ------ | ---------------------------------------------- |
| `color`        | string | Hex color assigned to the session               |
| `lastActivity` | number | Unix timestamp (ms) of the last PTY output      |
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
  "initialCommand": "htop",
  "color": "#4ade80"
}
```

All fields are optional. If `initialCommand` is provided, it will be sent to the shell after startup. If `color` is omitted, a color is assigned automatically from a built-in palette.

The `shell` field is validated against the list of detected shells (see `GET /api/shells`). The `cwd` field must be an absolute path to an existing directory.

**Response (200):**

```json
{
  "id": "e5f6g7h8",
  "url": "/terminal?id=e5f6g7h8"
}
```

**Response (400):**

```json
{ "error": "Invalid shell" }
```

```json
{ "error": "cwd must be an absolute path" }
```

```json
{ "error": "cwd is not a directory" }
```

```json
{ "error": "cwd does not exist" }
```

#### `PATCH /api/sessions/:id`

Update session properties.

**Request:**

```json
{
  "color": "#f87171",
  "name": "renamed-session"
}
```

All fields are optional.

**Response (200):**

```json
{ "ok": true }
```

**Response (404):**

```json
{ "error": "not found" }
```

---

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
    { "name": "bash", "path": "/bin/bash", "cmd": "/bin/bash" },
    { "name": "zsh", "path": "/bin/zsh", "cmd": "/bin/zsh" }
  ],
  "default": "/bin/zsh",
  "cwd": "/home/user"
}
```

| Field     | Type   | Description                                                        |
| --------- | ------ | ------------------------------------------------------------------ |
| `name`    | string | Display name of the shell                                          |
| `path`    | string | Full path to the shell executable                                  |
| `cmd`     | string | Original command name (on Windows this differs from the full path) |
| `default` | string | Path to the server's default shell                                 |
| `cwd`     | string | Server's default working directory                                 |

````

---

#### `GET /api/share-token`

Generate a fresh single-use OTT (one-time token) for sharing access. Requires authentication.

**Response (200):**

```json
{ "url": "https://your-tunnel-url/?ott=<token>" }
````

The returned URL auto-logs in whoever opens it. The token is single-use and expires in 5 minutes.

**Response (404):**

```json
{ "error": "auth disabled" }
```

Returned when the server was started with `--no-password`.

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

#### `POST /api/upload`

Upload an image file. The request body is the raw image data with the appropriate `Content-Type` header (e.g., `image/png`, `image/jpeg`).

**Request headers:**

- `Content-Type`: Must be an `image/*` type

**Response (200):**

```json
{ "path": "/tmp/termbeam-uuid.png" }
```

**Response (400):**

```json
{ "error": "Invalid content type" }
```

```json
{ "error": "No image data" }
```

**Response (413):**

```json
{ "error": "File too large" }
```

Maximum file size is 10 MB.

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
