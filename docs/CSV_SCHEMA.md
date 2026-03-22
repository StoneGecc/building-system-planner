# Building systems CSV schema

The viewer loads **any** CSV that follows this contract. Do not rely on specific `System_ID` patterns (e.g. `A4-01`) in application code—IDs are project-defined.

## Required columns

| Column | Notes |
|--------|--------|
| `System_ID` | Unique per system (`BLD` for building-wide rows). |
| `System_Type` | Stable slug (e.g. `clt_roof_assembly`). |
| `Location` | May be empty. |
| `Stack_Direction` | e.g. `wall_interior_to_exterior`, `slab_top_to_bottom`, `roof_exterior_to_interior`, `special`. |
| `System_Name` | Display name. |
| `Category` | `A`, `B`, `C`, or `D` (required for every system). |
| `#` | Layer index `1`…`n` or `TOTAL`. |
| `Layer`, `Material`, `Thickness_in`, `Approx_R_Value`, … | Through `Drawing_Note` (existing layer model). |

## Optional columns (metadata)

On **each data row**, these may be empty. The parser reads diagram/view metadata from the **first non-`TOTAL` row** of each system (lowest `#`).

| Column | Purpose |
|--------|---------|
| `Config_Key` | On `BLD` rows: semantic key (see below). Otherwise usually empty. |
| `Config_Value` | On `BLD` rows: value for that key (e.g. target `System_ID`). |
| `Sheet_Order` | Integer; sort order for sheets and composite callouts (ascending; missing sorts last). |
| `Diagram_Label` | Short label on composite leaders. |
| `Diagram_Hatch` | Hatch pattern id (e.g. `p-WOOD`, `p-CLT`)—must match defs in the viewer. |
| `Diagram_Section_Zones_JSON` | JSON array of normalized section zones (see **Zone JSON**). |
| `Diagram_Plan_Zones_JSON` | JSON array of normalized plan zones. |
| `View_Orientation` | `WALL`, `ROOF`, `FLOOR`, `SLAB`, or `SPECIAL`. |
| `View_Reverse` | `0` or `1`. |
| `View_Top_Label` | Optional face label (horizontal stacks). |
| `View_Bottom_Label` | Optional face label. |

## BLD (`System_ID = BLD`) rows

### Dimensions (existing)

Layer names map to building dimensions (footprint, scales, etc.) via `Thickness_in` as today.

### Diagram reference size (for scaling zones)

Use `Thickness_in` on dedicated layers (parsed by layer name):

| Layer | Meaning |
|-------|---------|
| `Diagram Section Ref Width` | Reference inner section width (px) used when authoring `Diagram_Section_Zones_JSON`. |
| `Diagram Section Ref Height` | Reference inner section height (px). |
| `Plan Ref Width` | Reference plan width (px). |
| `Plan Ref Height` | Reference plan height (px). |

### Layout wiring (`Config_Key` / `Config_Value`)

Rows where `Config_Key` is set (other columns may be minimal):

| Config_Key | Config_Value example | Purpose |
|------------|---------------------|---------|
| `exterior_wall_assembly` | `A4-06` | `System_ID` whose **total thickness** drives primary envelope width in the schematic. |
| `structural_clt_core` | `A4-04` | Core thickness inside the wall. |
| `interior_partition` | `A4-10` | Partition thickness. |
| `balcony_assembly` | `A4-14` | Balcony / edge deck thickness. |
| `system_id_prefix` | `A4-` | Prefix for “next system id” in the UI. |

Values must be `System_ID`s present in the same file.

## Zone JSON (normalized)

Coordinates are **0–1 fractions** of the reference rectangle:

- **Section:** origin = top-left of inner section box (screen strip to interior), size = BLD `Diagram Section Ref Width` × `Diagram Section Ref Height`.
- **Plan:** origin = plan origin, size = `Plan Ref Width` × `Plan Ref Height`.

Each element:

```json
{"nx":0.03,"ny":0.33,"nw":0.06,"nh":0.012,"nlx":0.074,"nly":0.334}
```

`nlx` / `nly` optional (leader anchor). Omitted = zone center.

## Portability smoke test

A minimal second project file with **non-`A4` IDs** lives at [`viewer/fixtures/minimal_building_systems.csv`](../viewer/fixtures/minimal_building_systems.csv). From `viewer/`, run `npm run smoke:csv` to parse it and build layout (no browser).

## Fallbacks

- Missing `View_Orientation`: derived from `Stack_Direction` when possible; else `SPECIAL`.
- Invalid or empty zone JSON: no highlight; leader uses drawing center.
- Missing layout `Config_*` / refs: parser supplies defaults matching this repo’s sample project.

## File

Primary file in this repo: `Building_Systems_Complete.csv`.
