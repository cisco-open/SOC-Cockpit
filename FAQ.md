<!--
SPDX-FileCopyrightText: 2026 Cisco Systems, Inc.
SPDX-License-Identifier: Apache-2.0
-->

# SOC Cockpit — Frequently Asked Questions

This FAQ covers the security and deployment questions most often asked about SOC
Cockpit. It explains what the project provides today, how it is designed to be
run, and where responsibility sits between the application and the environment it
runs in. It is written for anyone evaluating, deploying or operating the software
— security reviewers, architects, platform teams and administrators alike.

> **Deployment principle — read this first.** SOC Cockpit is intended to be
> deployed inside a **controlled, restricted environment that is reachable only
> by approved SOC staff.** It is not designed to be exposed directly to the
> public internet or to an organization's general user population. The trust
> boundary is established by the surrounding network and access layer — not by
> the application alone — so the guidance in this FAQ assumes a locked-down
> deployment as the baseline. See
> [What is the recommended deployment posture?](#what-is-the-recommended-deployment-posture)
> below.

## Contents

- [General](#general)
- [Security controls and secure development](#security-controls-and-secure-development)
- [Authentication and access control](#authentication-and-access-control)
- [Logging, monitoring and auditing](#logging-monitoring-and-auditing)
- [Encryption and data protection](#encryption-and-data-protection)
- [Database architecture](#database-architecture)
- [Reverse proxy support](#reverse-proxy-support)
- [Containerized deployment](#containerized-deployment)
- [Getting help and requesting features](#getting-help-and-requesting-features)

---

## General

### What is SOC Cockpit?

SOC Cockpit is a lightweight, web-based **operational management cockpit** for SOC
managers. It records the management layer of a security operations center —
rosters, daily stand-ups, objectives, issues, KPIs, processes and contacts — in a
single shared, API-backed store. It is a two-tier application: a React/TypeScript
single-page frontend built with Vite, and an Express (Node.js) API that persists
data to an embedded SQLite database.

### Is it a detection, response or SIEM product?

No. SOC Cockpit deliberately does not perform detection or response and does not
store security telemetry, alerts or case data. It complements those tools by
giving the *management* layer above them a durable, shared home.

### What is the recommended deployment posture?

SOC Cockpit should be deployed inside a **controlled network or system
environment that is accessible only to approved SOC staff** — for example an
internal management VLAN, a jump-host / bastion-reachable segment, or a private
subnet fronted by a Zero Trust access proxy. It is **not** intended to be
published to the public internet or made reachable by the organization's general
user population.

This is the primary control that establishes the application's trust boundary.
Concretely, we recommend:

- **Restrict network reach** to the approved SOC-management audience using
  firewall rules, network segmentation, VPN, or an identity-aware access proxy;
  do not expose the service on untrusted networks.
- **Bind to loopback / private interfaces only** and publish the app exclusively
  through your reverse proxy or ingress (see
  [Reverse proxy support](#reverse-proxy-support)).
- **Authenticate at the edge** so only known, approved SOC staff can reach the
  application (see
  [Authentication and access control](#authentication-and-access-control)).
- **Keep the built-in sign-in enabled** and grant the Admin role sparingly, so
  the app is not usable without both the network path *and* a valid account.

Because several enterprise controls are delegated to this surrounding
environment, deploying inside a restricted, staff-only network is a baseline
assumption throughout the rest of this FAQ rather than an optional extra.

### Is SOC Cockpit officially supported enterprise software?

It is **community open-source software**, published by Cisco Open under the
[Apache 2.0 License](LICENSE) and provided on an "as-is" basis as described in
that license. It is offered without warranty, and each organization remains
responsible for validating that its chosen deployment meets its own security and
compliance requirements.

### How are enterprise concerns like TLS, SSO and central logging handled?

By design, the application focuses on its own logic and **delegates enterprise
infrastructure concerns — TLS termination, single sign-on, and centralized
logging — to the environment around it.** This is a common and deliberate pattern
for focused open-source tools: it lets each organization apply its own approved
controls rather than inherit opinionated ones from the app. Throughout this FAQ,
where a capability is not built in, we say so plainly and describe the recommended
way to achieve the same outcome at the infrastructure layer.

---

## Security controls and secure development

### What secure coding practices are followed?

- **Type safety** — the frontend and shared types are written in TypeScript, and
  the production build fails on type errors (`tsc -b` runs as part of
  `npm run build`).
- **Parameterized data access** — all database queries use prepared statements;
  user-supplied values are never concatenated into SQL.
- **Input validation at boundaries** — uploads are constrained by an extension
  allowlist, size and file-count limits, and content signature checks.
- **Least-privilege error output** — responses for server (5xx) conditions are
  generic and never leak stack traces or internal details; full detail is logged
  server-side only.
- **Secrets as configuration** — secrets (LDAP service account, LLM keys) are supplied via
  environment variables / `.env`, which is excluded from version control. No
  secrets are committed to the repository.
- **Dependency hygiene** — a small, pinned set of well-known dependencies, with
  audit findings documented openly (see [SECURITY.md](SECURITY.md)).
- **Open review** — as an open-source project, every change is reviewable in the
  public commit history and pull-request workflow (see
  [DEVELOPMENT.md](DEVELOPMENT.md) and [CONTRIBUTING.md](CONTRIBUTING.md)).

### How does SOC Cockpit address the OWASP Top 10?

Several concrete controls map directly to common OWASP risks:

- **Injection (A03):** all database access uses parameterized/prepared statements.
- **Security misconfiguration / headers (A05):** the API applies the
  [`helmet`](https://helmetjs.github.io/) middleware for hardening HTTP headers;
  uploaded files are served with `X-Content-Type-Options: nosniff` and forced
  `Content-Disposition: attachment`.
- **Insecure design / unrestricted upload (A04, A08):** uploads enforce an
  extension allowlist, a size limit, a single-file limit, randomized (UUID-based)
  stored filenames, and **magic-number signature validation** so a renamed file
  cannot bypass the allowlist; files that fail validation are deleted.
- **Broken access control (A01):** every `/api` and `/uploads` request requires a
  signed-in user, and write actions are checked against the user's role;
  directory indexing and dotfiles are denied on the static uploads route.
- **Vulnerable components (A06):** dependencies are pinned and monitored via
  `npm audit` (see [SECURITY.md](SECURITY.md)).
- **Security logging (A09):** security-relevant events are logged for collection
  by your platform.

Adherence is a continuous effort rather than a one-time certification. Responsible
disclosure of any issue is welcomed through the process in
[SECURITY.md](SECURITY.md).

### How are vulnerabilities and dependencies managed?

Dependencies are a small, pinned set of well-known libraries, reviewed with
`npm audit`. Findings assessed as not exploitable in this project are documented
and tracked openly rather than silently suppressed — see the "Known advisories"
section of [SECURITY.md](SECURITY.md). Security issues can be reported privately
via GitHub private vulnerability reporting, with a defined acknowledgement and
response SLA and an escalation contact. Deploying organizations are encouraged to
run their own SCA / container image scanning in their pipeline and to watch the
repository for updates.

### What API security controls are in place?

- Per-user session authentication on all `/api` and `/uploads` routes, with
  role checks (Viewer / Operator / Admin), CSRF protection via a required
  request header, and throttling of failed sign-in attempts.
- Structured JSON error handling that returns generic messages for server errors
  without leaking internals.
- Upload endpoints that enforce type allowlist, size/count limits and signature
  validation, and clean up rejected files.
- Static uploads serving that denies directory listing and dotfiles and forces
  safe download headers.

We recommend additionally enforcing TLS, rate limiting and request-size limits
at the proxy/ingress layer.

### What hardening steps are recommended for a production deployment?

1. Terminate TLS at a reverse proxy / ingress with certificates from your PKI.
2. Complete first-time setup immediately after the first start, and connect
   Active Directory over `ldaps://` (or StartTLS) if you use company accounts.
3. Keep `SESSION_COOKIE_SECURE` enabled (default in production) and serve the
   app only over HTTPS.
4. Keep the app on loopback / a private network; expose it only through the proxy.
5. Run as a non-root, least-privilege service account; restrict the `data/` and
   `uploads/` directories to that account.
6. Enable volume/disk encryption for data at rest.
7. Ship logs to your SIEM and alert on anomalies.
8. Apply proxy-level controls: rate limiting, request-size limits, WAF.
9. Patch regularly and run SCA / image scans in your pipeline.
10. Back up the SQLite data directory and uploads on your standard schedule.

---

## Authentication and access control

### Does SOC Cockpit support LDAP / Active Directory integration?

**Yes.** An Admin configures it in the app under **Users > Company directory**:
server address, port, security mode (LDAPS, StartTLS, or unencrypted for labs
only), trusted CA certificate, timeout, a read-only service account, the search
starting point, the sign-in name type, an optional required group, new-user
handling (Admin approval or immediate access), the starting role, and
group-to-role mapping. **Test connection** and **Look up a user** buttons check
the settings before saving. Changes apply without a restart and are logged.

The same values can be set with `LDAP_*` environment variables; those override
the in-app values and show as locked. The service account password saved in the
app is encrypted (AES-256-GCM) with `SETTINGS_ENCRYPTION_KEY` or, if unset, a
key file in `data/`.

Company users sign in with their directory username and password; the app looks
them up with the service account and then verifies their password by binding as
that user. Passwords are never stored for company users. Group checks use direct
membership only (nested groups are not expanded).

### Does it provide Role-Based Access Control (RBAC)?

**Yes**, with three roles: **Viewer** (read-only, may use the assistant),
**Operator** (read and edit cockpit data) and **Admin** (everything, plus the
**Users** page to add local users, change roles, approve company users and
block accounts). The last active Admin cannot be blocked or demoted.

### How does authentication and authorization work today?

Every `/api` and `/uploads` request needs a signed-in user. Signing in creates a
random session token stored in an `HttpOnly`, `SameSite=Strict` cookie (also
`Secure` in production); only a hash of the token is kept in the database. Every
state-changing request must carry an `X-Requested-With: soc-cockpit` header,
which blocks cross-site request forgery. Blocking a user ends their sessions
immediately.

### How are administrative and user accounts managed?

On first start with an empty user table, the server prints a one-time setup code
to its console. The first person to enter it on the setup page creates the first
Admin; after that, public sign-up is permanently disabled. Admins then manage
accounts from the **Users** page.

### How are sessions and password policies handled?

Local passwords must be 12–256 characters and are hashed with scrypt (N=2^17,
r=8, p=1) and a random salt. Sessions expire after `SESSION_TTL_HOURS`
(default 12). After 5 failed sign-in attempts for the same username from the
same address, further attempts are refused for 15 minutes. Company (AD) users
inherit the password and lockout policies of your directory.

---

## Logging, monitoring and auditing

### Can SOC Cockpit integrate with a SIEM?

There is no native, turnkey SIEM connector today. The application emits
structured, timestamped events to **standard output / standard error** (for
example, document-upload activity including timestamp, record id, file name,
stored name, size and client IP, and server-side errors). In a containerized or
service-managed deployment these logs can be collected by your existing log
shipper (Fluent Bit/Fluentd, the platform logging driver, or a syslog/journald
forwarder) and forwarded to your SIEM. This "log to stdout, ship from the
platform" pattern is the recommended integration path. A dedicated SIEM/webhook
integration is a candidate for future work.

### What audit logging and monitoring are available?

The application writes timestamped operational and security-relevant events (such
as document-upload activity with actor IP, and server errors) to stdout/stderr. It
does not maintain a separate tamper-evident audit store inside the app. For
enterprise monitoring we recommend collecting container/process logs into your
SIEM for retention and alerting, placing the app behind a proxy that logs
authenticated user identity for per-user attribution, and monitoring the host and
the SQLite data directory with your existing endpoint and file-integrity tooling.
A dedicated in-app audit trail is a reasonable future enhancement for
organizations with strict audit requirements.

---

## Encryption and data protection

### Is data encrypted in transit?

The application itself serves plain HTTP and binds to the loopback interface by
default; it does **not** terminate TLS or manage certificates. TLS is expected to
be terminated by the reverse proxy / ingress in front of it (see
[Reverse proxy support](#reverse-proxy-support)). With that in place, client
traffic is encrypted in transit to the proxy. Because the app binds to loopback by
default, it is not directly reachable off-host unless deliberately exposed.

### Is data encrypted at rest?

The embedded SQLite database file and uploaded documents are stored on the host
filesystem and are **not** encrypted by the application. We recommend achieving
encryption at rest with full-disk / volume encryption (for example LUKS,
BitLocker, cloud-provider encrypted volumes, or encrypted persistent volumes in
your orchestrator), which is transparent to the app and aligns with typical
enterprise data-at-rest controls. Restrict filesystem permissions on the `data/`
and `uploads/` directories to the service account only.

---

## Database architecture

### What database does SOC Cockpit use?

It uses an **embedded SQLite database** accessed through Node.js's built-in
`node:sqlite` module (which is why the project requires Node.js ≥ 22.5.0). The
database is a single file stored under the application's `data/` directory. This
keeps the application simple and self-contained, which suits a single-team
operational tool.

### Can the database be deployed as a separate component or service?

Not in the current release. Data access is implemented directly against the
embedded SQLite engine, so there is no configuration option today to point the
application at an external database server. Decoupling persistence behind a
database abstraction (to support an external engine) is a recognized potential
enhancement, and contributions are welcome.

### Which external database platforms are supported?

None out of the box in the current release — SQLite embedded only.

### What architecture is recommended for enterprise deployments?

- Treat the `data/` directory as the **stateful volume**: place it on a reliable,
  backed-up, encrypted volume (or an orchestrator persistent volume) and restrict
  permissions to the service account.
- Run a **single application instance** against a given database file. SQLite
  suits the single-writer, team-scale workload this tool targets; horizontal
  scale-out against a shared writable file is not recommended.
- Establish and test a **backup/restore routine** (the `data/` directory and
  `uploads/` are the artifacts to protect).
- If your standards mandate a centrally managed RDBMS, treat external-database
  support as a prerequisite feature request and engage via the repository before
  deploying.

---

## Reverse proxy support

### Is deployment behind a reverse proxy supported and recommended?

**Yes — it is recommended for any non-local deployment.** The application is
explicitly designed to run behind a reverse proxy: it listens on plain HTTP, binds
to loopback by default, and delegates TLS termination, user authentication and
edge controls to the proxy. Nginx and Apache HTTP Server are both suitable.

### What should the reverse proxy be responsible for?

- **TLS termination** with certificates from your PKI/ACME, using modern
  protocol/cipher settings and HSTS.
- **Authentication** (SSO/OIDC/SAML or AD/LDAP) where per-user identity is
  required.
- **Reverse-proxying** to the app's HTTP port on loopback (default `3001` in
  production, where the Express server also serves the built frontend).
- **Edge protections:** rate limiting, request/body size limits, sensible
  timeouts, and optionally a WAF.
- **Header hygiene:** forwarding `X-Forwarded-*` headers and setting standard
  security response headers at the edge.

### Is there example configuration?

Yes — the examples below are illustrative; adapt them to your standards,
certificate paths and auth modules.

**Nginx**

```nginx
server {
    listen 443 ssl;
    server_name soc-cockpit.example.com;

    ssl_certificate     /etc/ssl/certs/soc-cockpit.crt;
    ssl_certificate_key /etc/ssl/private/soc-cockpit.key;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    client_max_body_size 25m;   # accommodates the app's document upload limit

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name soc-cockpit.example.com;
    return 301 https://$host$request_uri;
}
```

**Apache HTTP Server** (requires `mod_ssl`, `mod_proxy`, `mod_proxy_http`,
`mod_headers`)

```apache
<VirtualHost *:443>
    ServerName soc-cockpit.example.com

    SSLEngine on
    SSLCertificateFile    /etc/ssl/certs/soc-cockpit.crt
    SSLCertificateKeyFile /etc/ssl/private/soc-cockpit.key

    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/
    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>

<VirtualHost *:80>
    ServerName soc-cockpit.example.com
    Redirect permanent / https://soc-cockpit.example.com/
</VirtualHost>
```

Pair the proxy with the built-in sign-in so the app is not usable without both
the network path *and* a valid account.

---

## Containerized deployment

### Can the application run in a container (Docker / OpenShift, etc.)?

**Yes.** SOC Cockpit is a standard Node.js service that builds to static frontend
assets served by the Express server in production mode, which containerizes
cleanly. There is currently **no official published container image**, but
building one is straightforward and the runtime requirements are modest.

### Is there official deployment documentation or an image?

Local and production run instructions are documented in
[DEVELOPMENT.md](DEVELOPMENT.md) (`npm install`, `npm run build`, `npm start`).
There is no official container image or Helm chart today; publishing an image and
reference manifests is a reasonable roadmap item, and contributions are welcome.

### What are the runtime and infrastructure requirements?

- **Node.js ≥ 22.5.0** (required for the built-in `node:sqlite` module).
- A **persistent, encrypted volume** for the `data/` (SQLite) and `uploads/`
  directories, since these hold all state.
- **Environment configuration** via environment variables / secrets (`PORT`,
  `NODE_ENV=production`, optional `LDAP_*` and LLM settings) — inject
  secrets via your platform's secret store, not baked into the image.
- Exposure **only through your ingress / reverse proxy** for TLS and
  authentication.
- Run the container as a **non-root user** with a read-only root filesystem where
  possible, and writable access limited to the mounted data/uploads volume.

### Is there an example Dockerfile?

Yes — illustrative only; adapt to your base-image standards and scanning pipeline.

```dockerfile
# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
# Run as an unprivileged user; data/ and uploads/ should be mounted volumes
USER node
EXPOSE 3001
CMD ["node", "server/app.cjs"]
```

### Anything specific for OpenShift?

OpenShift assigns an arbitrary non-root UID by default. Ensure the mounted `data/`
and `uploads/` volumes are group-writable (root group) so the SQLite file and
uploads can be written, and front the service with an OpenShift Route/Ingress that
terminates TLS.

---

## Getting help and requesting features

- **Security policy, disclosure process and known advisories:**
  [SECURITY.md](SECURITY.md)
- **Build, run and contribution workflow:** [DEVELOPMENT.md](DEVELOPMENT.md),
  [CONTRIBUTING.md](CONTRIBUTING.md)
- **License terms:** [LICENSE](LICENSE)

If you need a capability that is not built in today, the most reliable path is to
raise it as an issue or feature request on the project's GitHub repository so it
can be discussed and, where appropriate, prioritized or contributed. As
open-source software under Apache 2.0, SOC Cockpit is offered without warranty,
and each organization remains responsible for validating that its deployment
architecture meets its own security and compliance requirements.
