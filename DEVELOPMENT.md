# Development

This document covers local setup, build, and coding conventions for SOC Cockpit.
For general contributor guidelines, see [CONTRIBUTING.md](/CONTRIBUTING.md).

## Prerequisites

Node.js >= 22.5.0 — the server uses the built-in `node:sqlite` module.

## Setup

```bash
npm install
cp .env.example .env   # then fill in values as needed
npm run dev            # starts the Vite web app and the API together
```

- Frontend dev server: http://127.0.0.1:5173/
- API server: http://127.0.0.1:3001/

## Production build

```bash
npm run build
npm start
```

In production mode the Express server serves the built frontend.

## Tests

```bash
npm test
```

Unit tests live in `tests/` and use the built-in Node.js test runner
(`node --test`). TypeScript modules under `src/` are loaded with Node's type
stripping, so they must stay free of TypeScript-only runtime syntax such as
`enum`.

## Demo data

`npm run seed:demo` loads a fictional dataset into `data/soc-cockpit.sqlite`
(analysts, a 24/7 roster, incidents, stand-up tasks, KPIs, objectives and more)
so every module and report can be tried. It refuses to run twice unless you pass
`-- --force`. See [docs/REPORTS.md](docs/REPORTS.md).

## Coding guidelines

- Keep changes focused; avoid unrelated refactors in the same PR.
- Match the existing code style. Run `npm run build` before submitting to
  ensure the TypeScript project compiles.
- Do not commit secrets, `.env`, or contents of `data/`, `uploads/`, or
  `artifacts/`.

## Branch and pull request workflow

1. Fork the repository and create a feature branch.
2. Make your change with clear, signed-off commits (`git commit -s`).
3. Ensure the build passes.
4. Open a pull request describing the change and its motivation.
5. Optionally add yourself to [CONTRIBUTORS.md](/CONTRIBUTORS.md) in the same
   pull request.
