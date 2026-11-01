# App notes for Phantom (Hackathon Hub)

These notes are sent to the phantom backend with every request. Keep them short and factual.

- A team is `{ id, name, members }`. `members` is an array of strings (default `[]`).
- A project is `{ id, teamId, title, pitch, votes }`. `votes` is a number that starts at `0` when the project is created.
- `POST /projects/:id/upvote` adds 1 to that project's `votes` (an `update` op on `projects`) and returns the full updated project.
- `GET /teams/:id/projects` returns the projects whose `teamId` is that team, as an array of projects.
- `GET /leaderboard` returns all projects as an array, sorted by `votes` (highest first), ties broken by `id` ascending.
