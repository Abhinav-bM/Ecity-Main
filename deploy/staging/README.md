# Standing up staging on Vultr

About 40 minutes, most of it waiting. Do the steps in order — each one
depends on the last.

Everything you type on the server is marked `[server]`; everything on your own
laptop is `[laptop]`.

---

## 0. Before you start

You need: a Vultr account with a card on it, and your GitHub login.

**One thing to know up front.** The app sets its login cookie as *Secure*,
which browsers only send over HTTPS. So staging needs a real hostname and a
real certificate — a bare `http://<ip>` will show the login page and then
silently refuse to log you in. We get both free with `sslip.io`, no domain
purchase needed. That is already set up in the `Caddyfile` here.

---

## 1. Create the server

Vultr → **Deploy** → **Deploy New Server**.

| Field | Choose |
|---|---|
| Type | **Cloud Compute — Shared CPU** |
| CPU | **Regular Performance** (the cheapest; Intel) |
| Location | **Mumbai** |
| Image | **Ubuntu 24.04 LTS x64** |
| Plan | **1 GB RAM / 1 vCPU / 25 GB** (≈ $5–6/month) |
| Auto Backups | **Enable** (+20%, worth it) |
| SSH Keys | add yours — see step 2 |
| Hostname | `ecity-staging` |

Leave IPv6, private networking and the rest at their defaults.

**Write down the IP address.** Everything below calls it `SERVER_IP`.

---

## 2. Your SSH key

`[laptop]` If you do not already have one:

```bash
ssh-keygen -t ed25519 -C "ecity-deploy"
# press Enter for the default path; set a passphrase and remember it
cat ~/.ssh/id_ed25519.pub
```

Paste that **public** key into Vultr's SSH Keys section before deploying. If
you already deployed, add the key in Vultr and rebuild, or paste it in via the
web console.

---

## 3. Harden the server

`[laptop]`

```bash
ssh root@SERVER_IP
```

**Paste these in small groups, not all at once.** `apt upgrade` stops on an
interactive prompt, and anything still sitting in your paste buffer gets eaten
as answers to it rather than run as commands. Two or three lines at a time.

`[server]` first the user:

```bash
adduser --disabled-password --gecos "" ecity
usermod -aG sudo ecity
rsync --archive --chown=ecity:ecity ~/.ssh /home/ecity/
passwd ecity
```

That last line matters. `--disabled-password` creates the account with no
password, which is right for key-only SSH login — but `sudo` then has nothing
to authenticate against and will refuse every time. Set one now and put it in
your password manager: it is what stops a stolen SSH key from becoming root.
Recovering from a missed `passwd` means going in through the provider's web
console, because root SSH is about to be turned off.

Then updates. **Wait for this one to finish before pasting anything else.**

```bash
apt update && apt upgrade -y
```

If a purple screen appears asking about a modified `sshd_config`, choose
**"keep the local version currently installed"** — Tab to `<Ok>`, Enter.
Installing the maintainer's version would undo the provider's own hardening.

Then brute-force protection and the firewall:

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Then turn off password logins. **This is not just the main config file.**
Ubuntu's cloud images ship `/etc/ssh/sshd_config.d/50-cloud-init.conf`
containing `PasswordAuthentication yes`, and a drop-in overrides the main file
— so editing only `sshd_config` silently achieves nothing:

```bash
sed -i 's/^\s*PasswordAuthentication.*/# &/' /etc/ssh/sshd_config.d/*.conf
cd /etc/ssh/sshd_config.d
echo 'PasswordAuthentication no' > 01-hardening.conf
echo 'KbdInteractiveAuthentication no' >> 01-hardening.conf
echo 'PermitRootLogin no' >> 01-hardening.conf
sshd -t && systemctl restart ssh
cd ~
```

The file is named `01-` deliberately: sshd takes the **first** value it finds,
so a hardening file has to sort before the cloud-init one. And `sshd -t`
validates the config, restarting only if it is clean — a typo cannot lock you
out mid-session.

**Verify it actually took**, rather than assuming:

```bash
id ecity
wc -l < /home/ecity/.ssh/authorized_keys
sshd -T | grep -E 'passwordauth|permitroot|kbdinter'
ufw status
systemctl is-active fail2ban
```

Expect: `ecity` in the `sudo` group, `2` keys, all three ssh settings `no`,
ufw active with 22/80/443, and fail2ban `active`.

`[laptop]` Open a **second** terminal and check you can get back in **before
closing the first one**:

```bash
ssh ecity@SERVER_IP
```

If that fails, you still have the root session open to fix it. Vultr's web
console is the backstop either way.

---

## 4. Install Docker

`[server]` as `ecity`:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ecity
exit
```

Log back in (the group only applies to a new session) and check:

```bash
ssh ecity@SERVER_IP
docker run --rm hello-world
```

---

## 5. Put the stack on the server

`[server]`

```bash
mkdir -p ~/app && cd ~/app
```

`[laptop]` from the repository root — replace `SERVER_IP` with the real one:

```bash
scp deploy/staging/docker-compose.yml ecity@SERVER_IP:~/app/
scp deploy/staging/Caddyfile          ecity@SERVER_IP:~/app/
scp deploy/staging/env.example        ecity@SERVER_IP:~/app/.env
```

`[server]` put the real IP into the Caddyfile:

```bash
cd ~/app
sed -i "s/SERVER_IP/$(curl -s ifconfig.me)/" Caddyfile
cat Caddyfile          # confirm it now reads like 139.84.x.x.sslip.io
```

---

## 6. Fill in the secrets

`[server]`

```bash
cd ~/app
openssl rand -base64 32     # copy this — it is AUTH_SECRET
openssl rand -base64 24     # copy this — it is the database password
nano .env
```

In `.env`:

- put the database password in **both** `DATABASE_URL` and
  `POSTGRES_PASSWORD` — they must match
- put the 32-byte string in `AUTH_SECRET`
- replace `SERVER_IP` in `AUTH_URL` with the real IP
- set `SEED_PASSWORD` to something you will remember

Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

```bash
chmod 600 .env      # secrets should not be world-readable
```

---

## 7. Let the server pull private images

GitHub's registry needs a token even for your own images.

`[laptop]` GitHub → Settings → Developer settings → **Personal access tokens**
→ **Tokens (classic)** → Generate new token. Tick **`read:packages`** only.
Copy it.

`[server]`

```bash
echo 'PASTE_TOKEN_HERE' | docker login ghcr.io -u Abhinav-bM --password-stdin
```

---

## 8. Give GitHub the keys to the server

`[laptop]`

```bash
cat ~/.ssh/id_ed25519      # the PRIVATE key, including the BEGIN/END lines
```

GitHub → your repo → Settings → Secrets and variables → **Actions** → New
repository secret. Add two:

| Name | Value |
|---|---|
| `SSH_HOST` | `SERVER_IP` |
| `SSH_KEY` | the whole private key, all lines |

---

## 9. Deploy

`[laptop]`

```bash
git push origin main
```

Watch the **Actions** tab. The workflow will: run the full test suite, build
two images, push them, migrate the database, sync the roles, start the app,
and health-check it. First run takes 5–10 minutes because nothing is cached.

If it goes red, read the failing step — it stops at the first problem rather
than carrying on.

---

## 10. Create the first login

The database is empty until it is seeded. Staging only — this creates accounts
with a known password.

`[server]`

```bash
cd ~/app
docker compose run --rm migrate npm run db:seed
```

---

## 11. Check it

Open `https://SERVER_IP.sslip.io` — with the real digits, e.g.
`https://139.84.171.22.sslip.io`.

- the padlock should be closed; Caddy fetches the certificate on first request,
  so the very first load can take a few extra seconds
- sign in as `admin@ecity.local` with the `SEED_PASSWORD` you chose
- walk the **M0** section of `docs/06-Manual-Test-Checklist.md`

---

## When something is wrong

```bash
cd ~/app
docker compose ps                    # what is running
docker compose logs --tail=100 app   # the app
docker compose logs --tail=50 caddy  # certificates and routing
docker compose logs --tail=50 db     # the database
free -h                              # memory — the usual suspect on a 1 GB box
```

| Symptom | Almost always |
|---|---|
| Login page loads, sign-in silently fails | You are on `http://`, not `https://` |
| `invalid reference format` on deploy | Uppercase in the image name |
| `denied` pulling the image | Step 7 not done, or the token lacks `read:packages` |
| Caddy will not get a certificate | Port 80 blocked, or the hostname does not resolve to this box |
| App restarts in a loop | `docker compose logs app` — usually a missing variable in `.env` |
| Everything is slow, or a container vanishes | Out of memory; `free -h`, then move to the 2 GB plan |

---

## After it works

- Vultr → your server → **Backups** — confirm automatic backups are on
- Read `docs/04-Deployment-Guide.md` §7 for off-site backups. Vultr's own
  snapshots protect against the disk dying, not against Vultr losing the
  account. Before real shop data exists, snapshots alone are fine.
