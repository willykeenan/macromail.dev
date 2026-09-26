# Self-host MacroMail

MacroMail is a free, open-source email tool for AI agents. This same Next.js app
runs on your machine. Mail data lives in SQLite under `MACROMAIL_DATA_DIR`.
There is no hosted database to provision.

Fill in `.env` from `.env.example` before a production start. Generate
`SESSION_SECRET` and `TOKEN_ENC_KEY` with `openssl rand -hex 32`.

## Run locally (3 commands)

```bash
cp .env.example .env
npm ci
npm run dev
```

Open http://localhost:3000. `next dev` is enough for trying the UI. For a
production-like process on the same machine:

```bash
npm run build
npm start
```

## Docker

Build the image, then run it with a volume for the SQLite data directory and
your env file:

```bash
docker build -t macromail .
docker run --env-file .env -e MACROMAIL_DATA_DIR=/data -p 3000:3000 -v macromail-data:/data macromail
```

The image listens on port 3000 and stores data in `/data`. A copied `.env`
still has `MACROMAIL_DATA_DIR=./data` for local runs, so `-e MACROMAIL_DATA_DIR=/data`
keeps SQLite on the volume. Change both the `-e` and the `-v` mount only if you
put the volume somewhere else.

## Run on your own Mac with launchd

This is how you keep MacroMail up across logins on a Mac that you control
(including the box that serves macromail.dev).

1. Install Node 22, clone this repo, copy `.env.example` to `.env`, set the
   secrets, then `npm ci && npm run build`.
2. Copy `deploy/launchd/dev.macromail.plist.template` to
   `~/Library/LaunchAgents/dev.macromail.plist`.
3. Replace every `__PLACEHOLDER__` with real values. Typical mappings:
   - `__APP_DIR__` — the clone (the directory that contains `package.json`)
   - `__NODE__` — the `node` binary (`command -v node`)
   - `__DATA_DIR__` — a writable folder for SQLite (match `MACROMAIL_DATA_DIR`)
   - `__LOG_DIR__` — a writable folder for stdout/stderr logs
   - `__SESSION_SECRET__` / `__TOKEN_ENC_KEY__` — the same values as in `.env`
   - `__MAILBOX_DOMAINS__` — the domains this server answers for (match `MACROMAIL_MAILBOX_DOMAINS`)
   launchd does not load `.env`. If you set optional OAuth or limit variables,
   copy those keys into the plist's `EnvironmentVariables` dict.
4. Load it:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.macromail.plist
launchctl enable gui/$(id -u)/dev.macromail
launchctl kickstart -k gui/$(id -u)/dev.macromail
```

The template binds to `127.0.0.1:3000`. Put a tunnel in front of that port.
Unload with `launchctl bootout gui/$(id -u)/dev.macromail`.

### Keep the Mac awake

Sleep takes the site down. Plug the Mac in. In System Settings → Energy (or
Battery → Options), allow the computer to stay on when the display is off, and
turn off standby if you need it reachable overnight. `caffeinate -s` also
prevents idle sleep while it is running.

## Public URL: Tailscale Funnel or Cloudflare Tunnel

MacroMail itself stays on localhost. A tunnel gives you HTTPS.

**Tailscale Funnel** (you already use Tailscale):

```bash
tailscale funnel 3000
```

**Cloudflare Tunnel** (quick try, or a named tunnel you already created):

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Point DNS at the tunnel if you want a stable hostname. OAuth redirect URIs must
match that public origin:

- `{origin}/api/inbox/callback/google`
- `{origin}/api/inbox/callback/outlook`

## Env vars

See `.env.example` for every variable the app reads. Required on a real
deployment: `MACROMAIL_DATA_DIR`, `SESSION_SECRET`, `TOKEN_ENC_KEY`.

- `MACROMAIL_MAILBOX_DOMAINS` — domains this server answers for. Mailboxes can
  only be created on them, and mail to them is delivered internally instead of
  over SMTP. Use domains you control. The default, `example.com`, is reserved
  and can never capture real internet mail.
- Google and Microsoft OAuth vars are optional and only enable read-only inbox
  connect.
- `MACROMAIL_MAX_USERS`, `MACROMAIL_USER_STORAGE_MB`, and
  `MACROMAIL_TRUSTED_PROXY` tune the built-in limits.

There is no server-wide SMTP account or Anthropic key. Each account saves its
own SMTP credentials and Anthropic key in Settings.

## Built-in limits

- Request bodies: 1 MB (4 MB for `/api/v1/emails/batch`); MCP batches of up to 20.
- Per email: 50 recipients, 256 KB each for text and html.
- Per account: 20 mailboxes, 30 SMTP sends and 200 internal deliveries per hour,
  100 MB of stored mail; each mailbox keeps its newest 2,000 messages.
- Sign-ups: 3 per IP per hour, 30 per hour server-wide, 500 accounts total.
- Sign-in: 5 attempts per email and IP, 10 per account, 30 per IP, per 15 minutes.
- SMTP connection tests: 5 per account and 10 per IP per hour. SMTP ports 465,
  587, and 2525 only.
