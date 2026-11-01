# Hackathon Hub — Lakshay

React 18 + Vite frontend. Every data operation goes through `/api/*`; there is no backend logic or fixture data in the app.

```sh
# From the repository root
pnpm install
pnpm --filter @phantom/demo-app dev
pnpm --filter @phantom/demo-app test
pnpm --filter @phantom/demo-app build
```

Open `http://127.0.0.1:5173`. Vite forwards `/api` to the proxy on port 4000. `PHANTOM_PROXY_TARGET` can override that target for the separate development fixture described in `../dashboard/README.md`. Production hosting requires a reverse proxy for `/api/*`.

## Screens and contracts

- Teams: fetch `/teams`; create with `{name, members: string[]}`.
- Team detail: fetch `/teams/:id` and `/teams/:id/projects`.
- Add project: `POST /projects` with `{teamId, title, pitch}`.
- Upvote: `POST /projects/:id/upvote` with no body; refresh server data after success.
- Leaderboard: fetch `/leaderboard` and preserve the server's ordering. Entries use project fields `{id, teamId, title, pitch, votes}`; `teamName` is optional.

The corner badge reflects `x-phantom-mode` from the latest response. Forms validate required text, disable repeated submissions while pending, and retain input on failure. Errors show a Retry toast; unsuccessful follow-up reads retry the read without repeating a successful mutation. Read requests are aborted when leaving a screen. A proxy reset is reflected after refresh.

Bundled fonts work offline. Layouts support desktop and narrow screens, keyboard navigation and reduced motion. Tests cover the complete team → project → vote → leaderboard journey, 502 retry, non-JSON gateway errors, mode headers, and avoiding duplicate writes after a refresh failure.
