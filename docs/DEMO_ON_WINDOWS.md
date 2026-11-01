# Running the Phantom demo on Garv's laptop (Windows)

**Why Garv's laptop:** on Abhik's Ubuntu laptop, Ubuntu's security blocks Codex's command sandbox for programs started from a normal terminal (`bwrap: setting up uid map: Permission denied`). Phantom works there, but Materialize can't write any code. Garv's Windows laptop doesn't use that Linux sandbox, and Materialize has already passed live on it.

---

## A. One-time setup (about 20 minutes, do it now)

### 1. Open PowerShell in the project folder
1. Press the **Windows key**, type **PowerShell**, and press **Enter**.
2. Go to the project folder. Use the folder you cloned it into, for example:
   ```powershell
   cd $HOME\phantom
   ```

### 2. Get the latest code
This brings in the "Your backend" page, the fixes, and the backup video.
```powershell
git pull
```

### 3. Check the tools
Run each line and check the result:
```powershell
node -v
pnpm -v
codex --version
codex login status
```
- `node -v` should print **v20** or higher.
- `pnpm -v` should print a version number.
- `codex login status` should say **"Logged in"**. If it doesn't, run `codex login` and sign in.

### 4. Check the `.env` file (the secret settings)
```powershell
Test-Path .env
```
- If it prints **True**, open it with `notepad .env` and check the first line is `CEREBRAS_API_KEY=csk-...`.
- If it prints **False**, create it:
  ```powershell
  Copy-Item .env.example .env
  notepad .env
  ```
  Paste the Cerebras key after `CEREBRAS_API_KEY=`, then save and close.
- Get the key from Abhik in a **private message**, never in a group chat or on GitHub.

### 5. Check that Codex works
```powershell
codex exec --skip-git-repo-check -s read-only "Reply OK"
```
- If it prints **OK**, you're done with this step.
- If it says the **model is not supported**, try:
  ```powershell
  codex exec --skip-git-repo-check -s read-only -m gpt-6-sol "Reply OK"
  ```
  If that prints OK, add the line `CODEX_MODEL=gpt-6-sol` to `.env` (with `notepad .env`).

### 6. Install and run the tests
```powershell
pnpm install
pnpm test
```
Every package should say **passed**. If anything fails, send the output to Abhik.

### 7. A full practice run, the real check on Windows
1. Clear old data and start everything:
   ```powershell
   node scripts/reset.mjs
   pnpm dev
   ```
   - If Windows Firewall asks about Node.js, click **Allow** for **private networks**.
   - **Leave this PowerShell window open.** Closing it stops the demo.
2. Open **Chrome or Edge** and go to `localhost:5173`. That's the Hub.
3. Open a **new window** with **Ctrl + N** and go to `localhost:5174`. That's the control room.
4. Put them side by side: click a window and press **Win + ←**, then click the other and press **Win + →**.
5. Make the text bigger with **Ctrl and +**, twice in each window.
6. Run the demo steps (Part C below), **including Materialize**.
7. When it finishes, check that **"Open your backend →"** shows **"Your backend is live."**

**If step 7 works, this laptop is demo-ready.**

To stop everything, click the PowerShell window and press **Ctrl + C**. If it asks "Terminate batch job (Y/N)?", type **Y**.

---

## B. 30 minutes before presenting

1. Plug in the **charger**. Set the screen to never sleep: **Settings → System → Power → Screen: Never** (while plugged in).
2. Connect to the **phone hotspot**, not the venue Wi-Fi.
3. **Turn on Do Not Disturb** in the Windows notification panel.
4. Start fresh in PowerShell, in the project folder:
   ```powershell
   node scripts/reset.mjs
   pnpm dev
   ```
5. Open both windows side by side and zoom in (A7, steps 2–5). **Don't click anything in the Hub yet.**
6. Open the backup video: in File Explorer, go to the project folder → **docs → assets → phantom-demo.mp4**. Press **pause** and minimise it.
7. **Make sure no other laptop is running Phantom with the same key.** The 5-calls-a-minute limit is shared, so Abhik's laptop must have `pnpm dev` stopped.

---

## C. The demo (same as before, plus the new page)

1. **Opening:** "This app has no backend code. An AI on Cerebras answers every request."
2. **Create a team** with a judge's name, then talk for about 20 seconds.
3. **Add a project.** It starts at 0 votes. Talk for about 20 seconds.
4. *(Final round only)* **Upvote it**, then click **← All teams**.
5. In the control room: click **Select all**, then **Materialize selected**.
6. **While it runs (about 1 minute):** "Codex is writing the real backend from our clicks, and the tests check it."
7. When it says **"✓ tests passed"**, click **"Open your backend →"**:
   > "This backend didn't exist a minute ago. Codex just wrote it, and the app is running on it now."
8. Back in the Hub: **create another team**. It's instant and shows **REAL**.
9. **Close:** "The frontend is the spec. Every click is a test."

**Rule: one click, then talk for about 20 seconds.** The free key allows 5 AI calls a minute.

---

## D. If something goes wrong

- **"Port already in use":** another `pnpm dev` is still running. Close the other PowerShell windows, or restart the laptop, then try again.
- **Materialize fails:** click **"↻ Retry with failure output"** once. If it fails again, play the video.
- **A "slow down" message:** wait 15 seconds while talking, then click again.
- **Anything else:** play the backup video and keep talking.

If anything fails during the practice run in step A7, send Abhik the exact error.
