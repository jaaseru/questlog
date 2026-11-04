# Managing users

Questlog has no sign-up page. You create and look after every account yourself, using a small command-line tool that ships inside the app. This guide covers:

1. [One-time setup](#1-one-time-setup): install the Railway CLI and connect it to your project
2. [Opening a shell in the app](#2-open-a-shell-in-the-app)
3. [Everyday tasks](#3-everyday-tasks): add someone, reset a password, rename, disable
4. [Troubleshooting](#4-troubleshooting)

You run the tool *inside* the running app container on Railway. There it already has the database connection, so there's nothing to configure.

---

## 1. One-time setup

You do this once per computer.

### Install the Railway CLI

Pick one:

```bash
npm install -g @railway/cli
```

```bash
brew install railway
```

Check that it works:

```bash
railway --version
```

### Sign in and link your project

```bash
railway login
```

This opens your browser to approve the sign-in.

Then, from any folder (for example your local copy of this repo):

```bash
railway link
```

Pick, in order: your **workspace**, the **project** questlog lives in, the **environment** (usually `production`), and the **questlog app service**. Pick the app, not the Postgres database. The CLI remembers this choice for that folder.

### SSH key

`railway ssh` connects with your computer's normal `ssh` program and needs an SSH key registered with Railway. The first time you run it, the CLI offers to register your local key. Say yes.

If you have no SSH key at all, create one first and press Enter to accept the defaults:

```bash
ssh-keygen -t ed25519
```

---

## 2. Open a shell in the app

From the folder you linked:

```bash
railway ssh
```

You're now in a shell inside the running container. The app lives in `/app`, so start there:

```bash
cd /app
```

Every command in the next section starts with:

```bash
node server/dist/cli/users.js
```

On its own, that prints the list of commands. Type `exit` to leave the shell when you're done.

> If you didn't run `railway link`, or want to target a different service, name it explicitly:
> `railway ssh --service <app-service-name> --environment production`

---

## 3. Everyday tasks

All of these run inside the shell from step 2.

### See who has an account

```bash
node server/dist/cli/users.js list
```

```
julian               Julian Aaserud           active
sam                  Sam Svensson             disabled
```

Columns: username (what people type to sign in), display name (what others see on shared tasks), and status.

### Add a person

```bash
node server/dist/cli/users.js add bob --name "Bob Berg"
```

You're asked for the password twice. Nothing appears on screen while you type; that's intentional.

```
Password (min 8 characters):
Repeat password:
Added bob (Bob Berg).
```

Then send Bob the site address, his username (`bob`) and the password, ideally through a different channel than the address. He signs in, and sees only his own tasks plus anything shared with him.

Rules:

- **Usernames:** 2–32 characters, using lowercase letters, digits, `.`, `_` or `-`. Capitals are lowered automatically, so people can type `Bob` at the login screen. A username can't be changed later, so pick it with care.
- **Display name** (`--name`): optional; defaults to the username. Quote it if it has spaces.
- **Passwords:** at least 8 characters.

### Reset someone's password (or your own)

```bash
node server/dist/cli/users.js passwd bob
```

Enter the new password twice. The change takes effect immediately for new sign-ins. Devices where Bob is already signed in stay signed in; to force him out everywhere, see [Sign everyone out](#sign-everyone-out).

### Change a display name

```bash
node server/dist/cli/users.js rename bob "Bob B."
```

Shared tasks show the new name as soon as people reload the page.

### Remove someone's access

```bash
node server/dist/cli/users.js disable bob
```

```
bob is disabled and signed out. Their tasks are kept.
```

Effect, immediately:

- Bob is signed out on every device and can't sign in again.
- His private tasks are kept untouched, in case you re-enable him.
- On tasks he shared, he still appears as a member, so others keep seeing the task. He just can't be added to new shared tasks.

To restore access, with his old password:

```bash
node server/dist/cli/users.js enable bob
```

There is deliberately no "delete user" command: disabling is reversible and never loses anyone's tasks.

### Sign everyone out

Change the `SESSION_SECRET` variable on the app service in Railway (for example to a new `openssl rand -hex 32`) and deploy. Every session ends; passwords are unaffected.

---

## 4. Troubleshooting

| Message or symptom | What it means / what to do |
| --- | --- |
| `DATABASE_URL is not set.` | You ran the tool on your own computer, not inside Railway. Run `railway ssh` first (step 2). |
| `No terminal to prompt on. Set QUESTLOG_PASSWORD instead.` | The tool couldn't show a password prompt. This happens if you pass the command straight to `railway ssh` on one line. Open the interactive shell with `railway ssh` instead, then run the command. |
| `Passwords did not match.` | The two entries differed. Run the command again. |
| `Passwords must be at least 8 characters.` | Choose a longer password. |
| `User "bob" already exists.` | Pick another username, or use `passwd` if you meant to reset Bob's password. |
| `Usernames are 2-32 characters: …` | The username has spaces or other characters that aren't allowed. Put the full name in `--name` instead. |
| `No user named "bob".` | Check the spelling with `list`. |
| `Cannot find module …/server/dist/cli/users.js` | You're not in `/app`. Run `cd /app` first. |
| Someone gets **Wrong username or password** | Check `list`: is the username spelled right, and is the account `active`? If unsure, set a fresh password with `passwd`. |
| Someone gets **Too many login attempts** | More than ten sign-in attempts from one network within 15 minutes are blocked for the rest of that window. Wait, or restart the app on Railway to clear it. |
| `railway ssh` asks about keys or fails to connect | See [SSH key](#ssh-key). Make sure `railway link` points at the app service, not the database. |

### Scripting (advanced)

For automation you can skip the prompt by putting the password in `QUESTLOG_PASSWORD`:

```bash
QUESTLOG_PASSWORD='a-long-password' node server/dist/cli/users.js add kim --name "Kim"
```

Avoid this for everyday use: the password can end up in your shell history.

### Running the tool from your own computer

Only needed if you can't use `railway ssh`. The tool works anywhere it can reach the database:

1. On Railway, open the **Postgres** service → **Variables**, and copy `DATABASE_PUBLIC_URL`. This needs the database's public networking (TCP proxy) to be enabled.
2. From your local copy of the repo, after `npm install`:

```bash
DATABASE_URL='<the public URL>' DATABASE_SSL=true npm run users:dev -w server -- list
```

If that fails with an SSL error, run it again without `DATABASE_SSL=true`.

Replace `list` with any command above. Prefer the `railway ssh` route when possible: it doesn't require exposing the database to the internet.
