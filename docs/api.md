# API Reference

TermBeam exposes a REST API and WebSocket interface.

## REST API

All API endpoints (except `/login`, `/api/auth`, `/api/version`, and `/api/config`) require authentication via cookie or Bearer token.

<!-- prettier-ignore -->
!!! note
    Bearer authentication accepts the raw password in the `Authorization: Bearer <password>` header, not a session token.

**Bearer auth failure (401):**

```json
{ "error": "unauthorized" }
```

Returned when the `Authorization: Bearer` token does not match the server password, or when an API request has no valid authentication. Bearer auth is also rate-limited to 5 attempts per minute per IP (returns 429).

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
    "lastActivity": 1719849600000,
    "git": {
      "branch": "main",
      "repoName": "owner/repo",
      "provider": "GitHub",
      "status": {
        "clean": false,
        "modified": 1,
        "staged": 0,
        "untracked": 2,
        "ahead": 3,
        "behind": 0,
        "summary": "1 modified, 2 untracked, 3↑"
      }
    }
  }
]
```

| Field          | Type        | Description                                                                                                  |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `color`        | string      | Hex color assigned to the session                                                                            |
| `lastActivity` | number      | Unix timestamp (ms) of the last PTY output                                                                   |
| `cwd`          | string      | Live working directory of the shell process (updates when the user `cd`s)                                    |
| `git`          | object/null | Git repository info for the session's cwd, or `null` if not in a git repo                                    |
| `git.branch`   | string      | Current branch name (or short SHA in detached HEAD)                                                          |
| `git.repoName` | string/null | Remote repository name (e.g. `owner/repo`)                                                                   |
| `git.provider` | string/null | Hosting provider: `GitHub`, `GitLab`, `Bitbucket`, `Azure DevOps`, or host                                   |
| `git.status`   | object      | Working tree status with `clean`, `modified`, `staged`, `untracked`, `ahead`, `behind`, and `summary` fields |

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
  "color": "#4ade80",
  "cols": 120,
  "rows": 30
}
```

All fields are optional. If `initialCommand` is provided, it will be sent to the shell after startup. If `color` is omitted, a color is assigned automatically from a built-in palette. The optional `cols` and `rows` fields set the initial terminal size (defaults to 120×30 if omitted).

The `shell` field is validated against the list of detected shells (see `GET /api/shells`). The `cwd` field must be an absolute path to an existing directory.

**Response (201):**

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

#### `GET /api/sessions/:id/detect-port`

Scan a session's scrollback buffer for the last `localhost` or `127.0.0.1` URL and return the port number.

**Response (200) — port found:**

```json
{ "detected": true, "port": 3000 }
```

**Response (200) — no port found:**

```json
{ "detected": false }
```

**Response (404):**

```json
{ "error": "not found" }
```

---

#### `DELETE /api/sessions/:id`

Kill and remove a session.

**Response (204):** No content.

**Response (404):**

```json
{ "error": "not found" }
```

### File Operations

#### `GET /api/sessions/:id/files`

Browse files and directories within a session's working directory.

**Query parameters:**

| Parameter | Type   | Description                                                 |
| --------- | ------ | ----------------------------------------------------------- |
| `dir`     | string | Subdirectory path relative to session CWD. Defaults to `.`. |

**Response (200):**

```json
{
  "base": "/home/user/project/src",
  "rootDir": "/home/user/project",
  "entries": [
    {
      "name": "components",
      "type": "directory",
      "size": 0,
      "modified": "2024-01-15T10:30:00.000Z"
    },
    { "name": "index.ts", "type": "file", "size": 1234, "modified": "2024-01-15T10:30:00.000Z" }
  ]
}
```

| Field     | Type   | Description                                      |
| --------- | ------ | ------------------------------------------------ |
| `base`    | string | Absolute path to the listed directory            |
| `rootDir` | string | Absolute path to the session's working directory |
| `entries` | array  | Files and directories in the listed path         |

Each entry contains `name` (string), `type` (`"file"` or `"directory"`), `size` (number, bytes), and `modified` (string or null — ISO 8601 timestamp, or `null` if stat fails).

Entries are sorted directories-first, then files alphabetically. Hidden files (starting with `.`) and symbolic links are excluded.

**Response (400):**

```json
{ "error": "Invalid dir parameter" }
```

**Response (401):**

```json
{ "error": "unauthorized" }
```

**Response (404):**

```json
{ "error": "Session not found" }
```

**Response (500):**

```json
{ "error": "Failed to read directory" }
```

---

#### `GET /api/sessions/:id/download`

Download a file from within a session's working directory.

**Query parameters:**

| Parameter | Type   | Description                                   |
| --------- | ------ | --------------------------------------------- |
| `file`    | string | File path relative to session CWD (required). |

**Response:** Binary file content with `Content-Disposition: attachment` header.

**Response (400):**

```json
{ "error": "Missing file parameter" }
```

```json
{ "error": "Not a regular file" }
```

**Response (401):**

```json
{ "error": "unauthorized" }
```

**Response (403):**

```json
{ "error": "Symbolic links are not allowed" }
```

**Response (404):**

```json
{ "error": "Session not found" }
```

```json
{ "error": "File not found" }
```

**Response (413):**

```json
{ "error": "File too large (max 100 MB)" }
```

---

#### `GET /api/sessions/:id/file-content`

Get the text content of a file. Used for in-browser file preview (e.g., markdown rendering).

**Query parameters:**

| Parameter | Type   | Description                                   |
| --------- | ------ | --------------------------------------------- |
| `file`    | string | File path relative to session CWD (required). |

**Response (200):**

```json
{
  "content": "# Hello World\n\nThis is a markdown file.",
  "name": "README.md",
  "size": 42
}
```

| Field     | Type   | Description                    |
| --------- | ------ | ------------------------------ |
| `content` | string | UTF-8 text content of the file |
| `name`    | string | Filename (basename)            |
| `size`    | number | File size in bytes             |

**Response (400):**

```json
{ "error": "Missing file parameter" }
```

```json
{ "error": "Not a regular file" }
```

**Response (401):**

```json
{ "error": "unauthorized" }
```

**Response (403):**

```json
{ "error": "Symbolic links are not allowed" }
```

**Response (404):**

```json
{ "error": "Session not found" }
```

```json
{ "error": "File not found" }
```

**Response (413):**

```json
{ "error": "File too large (max 2 MB)" }
```

---

#### `GET /api/sessions/:id/file-raw`

Serve a file inline from a session's working directory. Unlike the `/download` endpoint, this does not set a `Content-Disposition: attachment` header, making it suitable for in-browser rendering (e.g., images).

**Query parameters:**

| Parameter | Type   | Description                                   |
| --------- | ------ | --------------------------------------------- |
| `file`    | string | File path relative to session CWD (required). |

**Response:** File content served inline with the appropriate `Content-Type` header.

**Response (400):**

```json
{ "error": "Missing file parameter" }
```

```json
{ "error": "Not a regular file" }
```

**Response (401):**

```json
{ "error": "unauthorized" }
```

**Response (403):**

```json
{ "error": "Symbolic links are not allowed" }
```

**Response (404):**

```json
{ "error": "Session not found" }
```

```json
{ "error": "File not found" }
```

**Response (413):**

```json
{ "error": "File too large (max 20 MB)" }
```

---

#### `GET /api/shells`

List available shells on the host system.

Requires authentication (cookie or Bearer token).

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

Generate a fresh share token for sharing access. The token is single-use and expires after 5 minutes. Requires authentication.

**Response (200):**

```json
{ "url": "https://your-tunnel-url/?ott=<token>" }
````

The returned URL auto-logs in whoever opens it. The token is consumed on first use and expires after 5 minutes. When accessed through a tunnel, the URL uses the public tunnel address.

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

#### `GET /api/config`

Get public server configuration. No authentication required.

**Response:**

```json
{ "passwordRequired": true }
```

| Field              | Type    | Description                                    |
| ------------------ | ------- | ---------------------------------------------- |
| `passwordRequired` | boolean | Whether the server requires password to access |

#### `GET /api/update-check`

Check if a newer version of TermBeam is available on npm. Results are cached for 24 hours.
Requires authentication (session cookie or `Authorization: Bearer <password>`) when authentication is enabled. If the server is started with `--no-password`, this endpoint is accessible without authentication.

**Query parameters:**

| Parameter | Type    | Description                       |
| --------- | ------- | --------------------------------- |
| `force`   | boolean | Bypass cache and fetch fresh data |

**Response:**

```json
{
  "current": "1.10.2",
  "latest": "1.11.0",
  "updateAvailable": true,
  "method": "npm",
  "command": "npm install -g termbeam@latest",
  "canAutoUpdate": true,
  "restartStrategy": "exit"
}
```

| Field             | Type    | Description                                                                                           |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `method`          | string  | How TermBeam was installed: `npm`, `npx`, `yarn`, `pnpm`, `docker`, or `source`                       |
| `command`         | string  | Suggested update command for this installation method                                                 |
| `canAutoUpdate`   | boolean | Whether the in-app update mechanism can auto-update this installation                                 |
| `restartStrategy` | string  | How the server will restart after update: `pm2` (PM2 managed restart), `exit` (clean exit), or `none` |

When no update is available or the check fails, `updateAvailable` is `false` and `latest` may be `null`.

#### `POST /api/update`

Trigger an in-app update. Only works when `canAutoUpdate` is `true` (npm/yarn/pnpm global installs). Rate-limited to 1 request per 5 minutes.

**Response (success):**

```json
{
  "status": "updating",
  "method": "npm"
}
```

**Response (not supported):**

```json
{
  "error": "Auto-update not available for this installation method",
  "method": "source",
  "command": "git pull && npm install && npm run build:frontend",
  "canAutoUpdate": false
}
```

**Response (already in progress):**

Returns HTTP 409 with the current update state.

After triggering, progress is broadcast via WebSocket `update-progress` messages. The server will either restart (PM2) or exit cleanly (non-PM2) once the update is verified.

#### `GET /api/update/status`

Poll the current update status. Useful as a fallback when WebSocket is not connected.

**Response:**

```json
{
  "status": "idle",
  "phase": null,
  "progress": null,
  "error": null,
  "fromVersion": null,
  "toVersion": null,
  "startedAt": null,
  "restartStrategy": null
}
```

| Status                 | Description                                 |
| ---------------------- | ------------------------------------------- |
| `idle`                 | No update in progress                       |
| `checking-permissions` | Verifying write access to global npm prefix |
| `installing`           | Running package manager install command     |
| `verifying`            | Checking installed version after update     |
| `restarting`           | Update verified, server restarting          |
| `complete`             | Update finished successfully                |
| `failed`               | Update failed (see `error` field)           |

#### `GET /api/dirs?q=/path`

List subdirectories for the folder browser.

**Response:**

```json
{
  "base": "/home/user",
  "dirs": ["/home/user/projects", "/home/user/documents"],
  "truncated": false
}
```

| Field       | Type    | Description                                             |
| ----------- | ------- | ------------------------------------------------------- |
| `base`      | string  | Absolute path that was listed                           |
| `dirs`      | array   | Absolute paths of subdirectories                        |
| `truncated` | boolean | `true` when results were cut off at the 500-entry limit |

#### `POST /api/upload`

Upload an image file. The request body is the raw image data with the appropriate `Content-Type` header (e.g., `image/png`, `image/jpeg`).

**Request headers:**

- `Content-Type`: Must be an `image/*` type

**Response (201):**

```json
{ "id": "uuid", "url": "/uploads/uuid", "path": "/tmp/termbeam-uuid.png" }
```

**Response (400):**

```json
{ "error": "Invalid content type" }
```

```json
{ "error": "No image data" }
```

```json
{ "error": "File content does not match declared image type" }
```

Returned when the file's magic bytes don't match the declared `Content-Type` header.

**Response (413):**

```json
{ "error": "File too large" }
```

Maximum file size is 10 MB.

#### `POST /api/sessions/:id/upload`

Upload a file to a session's working directory. The request body is the raw file content. The filename is provided via the `X-Filename` header and sanitized server-side (path traversal sequences are stripped). Duplicate filenames are auto-renamed (e.g., `file (1).txt`).

**Request headers:**

- `Content-Type`: The file's MIME type (e.g., `application/octet-stream`)
- `X-Filename`: Original filename (required)
- `X-Target-Dir`: Override destination directory (optional, defaults to session cwd)

**Response (201):**

```json
{ "name": "script.sh", "path": "/home/user/project/script.sh", "size": 1024 }
```

**Response (400):**

```json
{ "error": "Missing X-Filename header" }
```

```json
{ "error": "Invalid filename" }
```

```json
{ "error": "Empty file" }
```

**Response (404):**

```json
{ "error": "Session not found" }
```

**Response (413):**

```json
{ "error": "File too large (max 10 MB)" }
```

#### `GET /uploads/:id`

Serve a previously uploaded file by its opaque ID. Requires authentication.

**Response:** The file content with appropriate content type.

**Response (404):**

```json
{ "error": "not found" }
```

---

### Port Preview

#### `GET /preview/:port/*`

Reverse-proxies requests to a service running on `127.0.0.1:<port>`. All HTTP methods are supported. The path after the port is forwarded as-is, along with query strings and request headers.

Requires authentication (cookie or Bearer token).

<!-- prettier-ignore -->
!!! warning "Single-port proxy"
    The preview proxies **one port at a time** via HTTP only. It does not proxy WebSocket connections, so live-reload and HMR will not work. Each request is forwarded individually — there is no persistent upstream connection.

<!-- prettier-ignore -->
!!! info "Limitations when accessed through a tunnel"
    - **Server-rendered apps** (Next.js SSR, Rails, Django) work best — the browser receives complete HTML with no extra fetches.
    - **Client-side SPAs** may break if they make API calls to a different port or use hardcoded `localhost` URLs. Apps that use a single point with an internal reverse proxy (e.g., nginx proxying `/api` to a backend) work fine.
    - **Multi-port architectures** (e.g., frontend on port 3000 making API calls to port 4000) won't work unless the app routes all requests through TermBeam's preview proxy (e.g., `/preview/4000/api` instead of `localhost:4000/api`).
    - The upstream service must be listening on `127.0.0.1` (localhost) on the machine running TermBeam.

**Response:** The upstream response is streamed back with its original status code and headers.

**Response (400):**

```json
{ "error": "Invalid port: must be an integer between 1 and 65535" }
```

**Response (502):**

```json
{ "error": "Bad gateway: upstream server is not responding" }
```

Returned when the upstream service is unreachable or the connection is refused.

**Response (504):**

```json
{ "error": "Gateway timeout: upstream server did not respond in time" }
```

Returned when the upstream service does not respond within 10 seconds.

---

## WebSocket API

Connect to `ws://host:port/ws`.

### Message Types (Client → Server)

#### Authenticate

If the server has a password set and the WebSocket connection wasn't authenticated via cookie, send an auth message first. When the server is started with `--no-password`, authentication is skipped automatically.

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

**Auth Failure:**

```json
{ "type": "error", "message": "Unauthorized" }
```

The connection is closed after sending this message. Sending any non-auth message before authenticating also results in this error and connection closure.

#### Attach to Session

```json
{ "type": "attach", "sessionId": "a1b2c3d4" }
```

After a successful `attached` response, the server immediately sends an `output` message containing the session's scrollback buffer (up to ~1,000,000 characters). When the buffer grows beyond this size, it is trimmed back to ~500,000 characters to keep memory usage bounded, allowing the client to display recent terminal output.

#### Send Input

```json
{ "type": "input", "data": "ls -la\r" }
```

#### Resize Terminal

```json
{ "type": "resize", "cols": 120, "rows": 30 }
```

The server validates resize dimensions: `cols` must be between 1–500 and `rows` between 1–200. Values outside these bounds are ignored.

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

#### Update Progress

Sent during an in-app update (triggered via `POST /api/update`). Allows the frontend to show real-time progress without polling.

```json
{
  "type": "update-progress",
  "status": "installing",
  "phase": "Installing update...",
  "progress": "added 42 packages...",
  "error": null,
  "fromVersion": "1.14.0",
  "toVersion": null,
  "restartStrategy": "exit"
}
```

The `status` field follows the same values as `GET /api/update/status`. When `status` reaches `restarting`, the WebSocket connection will close shortly after (close code 1012 for non-PM2 installs).

---

## See Also

- **[Architecture](architecture.md)** — system design, module responsibilities, and data flow
- **[Security](security.md)** — threat model, safe usage, and security features
