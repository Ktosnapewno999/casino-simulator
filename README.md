# Casino Simulator

A static, play-money casino simulator that can be hosted directly on GitHub Pages.

## Games

- Slots
- Blackjack
- European roulette
- Pass-line craps
- Baccarat
- Video poker

## GitHub Pages

1. Push these files to a GitHub repository.
2. Open the repository settings.
3. Go to Pages.
4. Choose the branch that contains `index.html`.
5. Save and open the published Pages URL.

No build step is required.

## Test Backend With Email Verification

The backend code is included in this repo for testing, but GitHub Pages will not run it. Run it locally or deploy it to a Node host such as Render, Railway, Fly.io, or a VPS.

1. Install dependencies:

```bash
npm install
```

2. Copy the environment example:

```bash
cp .env.example .env
```

3. Fill in `.env` with your Maileroo SMTP credentials:

```text
SMTP_HOST=smtp.maileroo.com
SMTP_PORT=587
SMTP_USER=your-maileroo-smtp-username
SMTP_PASS=your-maileroo-smtp-password
SMTP_FROM="Casino Simulator <no-reply@casino.fans-only.me>"
APP_ORIGIN=http://localhost:8123
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-admin-password
```

4. Start the backend:

```bash
npm run dev
```

5. Start the static frontend in another terminal:

```bash
python3 -m http.server 8123
```

6. Edit `config.js` for local testing:

```js
window.CASINO_API_URL = "http://localhost:3000";
```

Registration will save users to SQLite and send a verification code by email. If SMTP credentials are missing, the backend prints the verification code in the terminal for test use.

Admin accounts are created from `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` when the backend starts. Admins can see user balances, total wagered/won, games played, and add play money from the in-app Admin panel.

## Raspberry Pi Backend Without Port Forwarding

The repo includes an SSH-friendly setup script for Raspberry Pi OS/Debian. It installs the Node backend, creates a systemd service, installs Cloudflare Tunnel, and routes:

```text
https://api.casino.fans-only.me -> http://localhost:3000
```

On the Raspberry Pi:

```bash
git clone git@github.com:ktosnapewno999/casino-simulator.git
cd casino-simulator
chmod +x scripts/rpi-backend-cloudflare-setup.sh
./scripts/rpi-backend-cloudflare-setup.sh
```

During setup, `cloudflared tunnel login` prints a URL. Open it on your computer, choose `fans-only.me`, then return to the SSH session.

After it finishes, set `config.js` in the frontend to:

```js
window.CASINO_API_URL = "https://api.casino.fans-only.me";
```
