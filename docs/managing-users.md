# Managing users

Questlog has no sign-up page. You create and look after every account yourself. There are two ways:

- **The Admin page** in the app: for everyday use, from your phone or computer. Only the admin (you) can open it.
- **The command-line tool**: a backup for when you can't use the page, e.g. you've lost your own password or need to hand admin rights to someone else.

Contents:

- [The Admin page](#the-admin-page)
- [What each person can do themselves](#what-each-person-can-do-themselves)
- Command line: [1. One-time setup](#1-one-time-setup) · [2. Open a shell](#2-open-a-shell-in-the-app) · [3. Commands](#3-everyday-tasks) · [4. Troubleshooting](#4-troubleshooting)

---

## The Admin page

**Phone:** tap your name in the top bar → **Admin**. **Computer:** **Admin** in the sidebar, above your name.

Who's admin: the first account ever created, which is the one made from `APP_PASSWORD` / `ADMIN_USERNAME` when you upgraded. Nobody else sees the page or its link, and the server refuses its data to anyone else.

### People

Every account, with its username, when they last signed in, and badges for **Admin** and **Disabled**. Tap a person to manage them:

| Action | What happens |
| --- | --- |
| **Rename** | Changes the name others see on shared tasks. The username (what they sign in with) never changes. |
| **Reset password** | Type one, or tap **Generate** for a strong random one. They're signed out on every device right away; give them the new password. |
| **Sign out everywhere** | Ends all their sessions, e.g. if they lost a phone. Their password stays the same. |
| **Disable** / **Enable** | Disable blocks sign-in and signs them out at once; their tasks are kept. Enabling lets them sign in again with their existing password. Admin accounts can't be disabled here, so you can't lock yourself out. |

### Add a person

Fill in a **username** (2–32 characters: letters, digits, `.`, `_` or `-`; stored in lowercase), an optional **display name**, and a **password** (tap **Generate**). After **Add person**, the page shows the username and password once so you can copy them. Send them through a different channel than the site address, and ask the person to change the password under **Account**.

### Recent activity

The last 100 security events, newest first, with time and network address: sign-ins, **failed sign-ins (in red)**, sign-ins blocked after too many attempts, password changes and resets, and every change you make to an account. Passwords are never recorded. A burst of red lines for one username means someone is guessing; consider resetting that person's password.

## What each person can do themselves

Everyone has an **Account** page (tap their name in the top bar, or in the sidebar on a computer):

- **Change password**: needs the current one. Their other devices are signed out; the one they're on stays signed in.
- **Sign out other devices**: ends every session except the current one.

---

# Command line

Use this when the Admin page isn't an option. You run the tool *inside* the running app container on Railway. There it already has the database connection, so there's nothing to configure.

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

Enter the new password twice. Bob is signed out on every device at once and signs in with the new password.

Locked yourself out? This works for your own account too: `passwd julian`.

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

### Sign someone out on every device

```bash
node server/dist/cli/users.js signout bob
```

### Admin rights

```bash
node server/dist/cli/users.js grant-admin bob
```

```bash
node server/dist/cli/users.js revoke-admin bob
```

Admins can open the Admin page. You can't revoke the last remaining admin, so there's always one. Admin rights can only be changed here, never from the page.

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
