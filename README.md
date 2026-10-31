# SOC Cockpit

[![Author](https://img.shields.io/badge/Author-Kunal_Hatode-blue)](https://github.com/ke0xes)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/cisco-open/SOC-Cockpit)](https://github.com/cisco-open/SOC-Cockpit/commits/main)
[![GitHub License](https://img.shields.io/github/license/cisco-open/SOC-Cockpit)](https://github.com/cisco-open/SOC-Cockpit/blob/main/LICENSE)
[![Visitors](https://hits.sh/github.com/cisco-open/SOC-Cockpit.svg?label=visitors&color=1b4d3e)](https://hits.sh/github.com/cisco-open/SOC-Cockpit/)
[![GitHub Stars](https://img.shields.io/github/stars/cisco-open/SOC-Cockpit?logo=github)](https://github.com/cisco-open/SOC-Cockpit/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/cisco-open/SOC-Cockpit?logo=github)](https://github.com/cisco-open/SOC-Cockpit/network/members)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-fbab2c.svg)](CODE_OF_CONDUCT.md)
[![Maintainer](https://img.shields.io/badge/Maintainer-Cisco-00bceb.svg)](https://opensource.cisco.com)


SOC Cockpit is a web-based operational command console for SOC (Security Operations Center) managers. It is designed around dense, shared operations
workflows rather than a single-user desktop shell.

**Website:** [cisco-open.github.io/SOC-Cockpit](https://cisco-open.github.io/SOC-Cockpit/) ·
[Product tour](https://cisco-open.github.io/SOC-Cockpit/tour/) ·
[Get started](https://cisco-open.github.io/SOC-Cockpit/get-started/)

![SOC Cockpit command dashboard](docs/images/01-command-dashboard.png)

_The command dashboard, shown with a fictional "Meridian Global SOC" dataset.
Screens for every module — roster, stand-ups, KPIs, issues, objectives,
projects, processes, executive update and settings — are in the
[product tour](https://cisco-open.github.io/SOC-Cockpit/tour/)._

#### **Why it was built** 
Most SOCs have mature tooling for detection and response
— a SIEM, an EDR, a SOAR, a ticketing system. Far fewer have anything for the
management layer that sits above them: who is covering the night shift next
Tuesday, what the team committed to in this morning's stand-up, which
objectives have quietly stalled, and where the evidence for this month's KPI
report is going to come from. That layer usually lives in a spreadsheet on one
manager's laptop, a chat thread, and a slide deck rebuilt from scratch every
reporting cycle. It works until the person holding it is on leave, hands over a
shift, or leaves the team. SOC Cockpit exists to give that layer a shared,
durable home.

#### **What it solves** 
The core problem is fragmentation: the operational record
of a SOC is scattered across tools that were never meant to hold it, so nothing
is authoritative and everything is re-keyed. Stand-ups are held verbally and
lost by the afternoon, leaving no record of what was agreed or whether it was
finished. Coverage gaps are discovered on the day rather than during planning.
Objectives and issues drift without a visible owner, due date or progress
signal. Monthly reporting becomes an archaeology exercise, reconstructing weeks
of work from memory and inboxes. Cockpit replaces that with a single API-backed
store where roster, tasks, objectives, issues, KPIs, contacts and notes are
recorded once, retain their history, and stay visible to the whole team rather
than to one person.

#### **How SOC managers benefit** 
Shift rosters are planned into the future, so
coverage gaps surface while there is still time to fix them. Daily stand-up and
stand-down tasks are captured against the Eisenhower Decision Matrix — Do,
Delegate, Delay, Discard — with a lead, duration and status on every item, and
incomplete work can be carried over rather than forgotten. Tasks link to the
objectives they serve, so it is clear which day-to-day effort is actually moving
a commitment forward and which objectives are receiving no attention at all.
KPIs, issues and follow-ups are tracked continuously instead of assembled at
month end, which turns reporting into an export rather than a rebuild. And
because stand-ups can be captured in a spreadsheet and imported later, the
process survives the days when the app is unavailable.

#### **Where the AI helps** 
The value of an assistant in a SOC depends entirely on
whether you can trust what it tells you, so Cockpit's AI is deliberately
constrained: Keo answers strictly from the live cockpit record — roster
coverage, open issues, objectives, KPIs, stand-up tasks and notes — rather than
from general knowledge. Ask which shifts are short next week, how much effort
went into a given objective, or what is still open from last month, and the
answer comes from the data in front of you. Routine counting questions are
resolved directly from the database rather than by the model at all, so those
figures are arithmetic, not inference. Alongside this, the advisor brief turns a
day's roster, tasks, issues and KPIs into a written management summary, which
removes most of the manual effort behind daily and monthly reporting. Because
the integration targets any OpenAI-compatible endpoint, teams can point it at a
self-hosted model such as Ollama or vLLM and keep operational data entirely
inside their own environment — and if no provider is configured at all, the app
falls back to a locally generated brief and keeps working.

Features:

- A Vite + React + TypeScript frontend with a dense, ERP-style dashboard.
- An Express API with a shared SQLite backing store in `data/soc-cockpit.sqlite`.
- Future-dated shift roster planning for workforce coverage.
- Standup and standdown task management based on the Eisenhower Decision
  Matrix: Do, Delegate, Delay, and Discard.
- Operational modules for KPIs, follow-ups, assets, objectives, projects,
  contacts, notes, and advisor briefs.
- Optional AI advisor brief generation and an in-app assistant, powered by any
  OpenAI-compatible Chat Completions endpoint. Without a configured provider,
  the app falls back to a locally generated brief.
- Keo, the in-app AI SOC assistant. Keo stands for Knowledge Efficiency Operator
  and answers questions grounded only in the live cockpit data (roster coverage,
  open issues, objectives, KPIs, standup tasks, and notes).

## Prerequisites

- Node.js >= 22.5.0 (the server uses the built-in `node:sqlite` module).
- npm.

## Quick start

```bash
npm install
cp .env.example .env    # then edit values as needed
npm run dev             # start the web app and API together
```

- Web UI (dev): http://127.0.0.1:5173/
- API: http://127.0.0.1:3001/

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

## Architecture

- `src/`: web UI, API client, and module views.
- `server/app.cjs`: Express API server and production static hosting.
- `server/db.cjs`: SQLite schema, default settings, CRUD operations, and advisor
  brief generation.

## Commands

```bash
npm install
npm run dev             # start the web app and API together
npm run build           # type-check and build the frontend
npm start               # serve the production build from the API server
```

## Environment

Configuration is read from a `.env` file. Copy `.env.example` to `.env` and set
values:

| Variable          | Required | Default                     | Purpose                                             |
| ----------------- | -------- | --------------------------- | --------------------------------------------------- |
| `PORT`            | No       | `3001`                      | API / production server port.                       |
| `NODE_ENV`        | No       | `development`               | Set to `production` to serve the built frontend.    |
| `SESSION_TTL_HOURS` | No     | `12`                        | How long a sign-in session lasts.                   |
| `SESSION_COOKIE_SECURE` | No | `true` in production        | Send the session cookie over HTTPS only.            |
| `LDAP_URL`        | No       | _(unset)_                   | `ldaps://` URL of Active Directory. Empty = local accounts only. |
| `LDAP_BASE_DN`    | With LDAP | _(unset)_                  | Search base for user lookups.                       |
| `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | With LDAP | _(unset)_ | Read-only service account for user lookups.   |
| `LDAP_USER_FILTER` | No      | `sAMAccountName={username}` filter | LDAP filter used to find the user.          |
| `LDAP_STARTTLS`, `LDAP_CA_CERT_PATH`, `LDAP_ALLOW_INSECURE` | No | `false` / _(unset)_ / `false` | TLS options for LDAP. |
| `OPENAI_API_KEY`  | No       | _(unset)_                   | Enables AI features. If empty, a local fallback is used. |
| `OPENAI_BASE_URL` | No       | `https://api.openai.com/v1` | Base URL of an OpenAI-compatible API.               |
| `OPENAI_MODEL`    | No       | `gpt-4o-mini`               | Model / deployment name.                            |

The LLM integration targets the standard OpenAI-compatible
`POST {OPENAI_BASE_URL}/chat/completions` API, so it works with OpenAI, Azure
OpenAI-compatible gateways, and self-hosted servers such as Ollama or vLLM.

## Behavior notes

- **Sign-in is required.** On first start (no users), the server prints a
  one-time setup code to its console; open the app and use it to create the
  first Admin. Public setup is then disabled for good.
- Users are either **local** (password hashed with scrypt) or **company**
  (checked against Active Directory). Company users are registered on their
  first sign-in but stay blocked until an Admin approves them in **Users**.
- Roles: **Viewer** (read-only), **Operator** (read and edit), **Admin**
  (everything plus user management).
- A new database starts empty apart from default settings (clock zones, shift
  labels); no sample records are loaded. The screenshots above use a fictional
  dataset.
- The API is the source of truth for all editable modules.
- Production mode serves the built frontend from the Express server.
- `data/`, `uploads/`, and `artifacts/` hold local runtime data and are
  git-ignored.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require a DCO sign-off.
Please also review the [Code of Conduct](CODE_OF_CONDUCT.md). For local setup,
build instructions, and coding conventions, see [DEVELOPMENT.md](DEVELOPMENT.md).
Project maintainers are listed in [MAINTAINERS.md](MAINTAINERS.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Do not open public
issues for security problems.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
