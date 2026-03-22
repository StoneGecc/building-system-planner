# Building system planner

CSV-driven viewer and tooling for building-system assemblies (plans, sections, exports). The web app lives in `viewer/`; Python helpers for CSV normalization and merging are in `scripts/`.

## Data

- **`Building_Systems_Complete.csv`** — project dataset at the repo root.
- **`viewer/fixtures/minimal_building_systems.csv`** — small fixture for smoke tests.
- Schema and column contract: **[docs/CSV_SCHEMA.md](docs/CSV_SCHEMA.md)**.

## Viewer (React + Vite)

```bash
cd viewer
npm ci
npm run dev
```

Production build:

```bash
npm run build
```

CSV smoke script: `npm run smoke:csv` (from `viewer/`).

## Python scripts (`scripts/`)

- `normalize_building_csv.py` — normalize building CSV.
- `merge_building_csv_seed.py` — merge seed data.
- `expand_building_csv.py` — expand CSV.

## Copyright

Copyright (c) 2026 StoneGecc. All rights reserved.

This repository and its contents are proprietary. No license is granted to use, copy, modify, or distribute the software or data except as permitted by the owner in writing.
