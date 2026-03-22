#!/usr/bin/env python3
"""Insert BLD diagram/config rows and per-system diagram metadata from viewer/scripts/seed-output.json."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "Building_Systems_Complete.csv"
SEED_PATH = ROOT / "viewer" / "scripts" / "seed-output.json"


def col_index(header: list[str], name: str) -> int:
    return header.index(name)


def main() -> None:
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    i_sys = col_index(header, "System_ID")
    i_num = col_index(header, "#")
    i_ck = col_index(header, "Config_Key")
    i_cv = col_index(header, "Config_Value")
    i_so = col_index(header, "Sheet_Order")
    i_dl = col_index(header, "Diagram_Label")
    i_dh = col_index(header, "Diagram_Hatch")
    i_sj = col_index(header, "Diagram_Section_Zones_JSON")
    i_pj = col_index(header, "Diagram_Plan_Zones_JSON")
    i_vo = col_index(header, "View_Orientation")
    i_vr = col_index(header, "View_Reverse")
    i_vt = col_index(header, "View_Top_Label")
    i_vb = col_index(header, "View_Bottom_Label")
    i_note = col_index(header, "Drawing_Note")

    def empty_row() -> list[str]:
        return [""] * len(header)

    # Find last BLD row index (before first non-BLD)
    last_bld = 0
    for r in range(1, len(rows)):
        if rows[r][i_sys] == "BLD":
            last_bld = r
        else:
            break

    def bld_row(num: int, layer: str, thick: str, note: str, ck: str = "", cv: str = "") -> list[str]:
        r = empty_row()
        r[i_sys] = "BLD"
        r[col_index(header, "System_Type")] = "building_dimensions"
        r[col_index(header, "System_Name")] = "Building Dimensions"
        r[i_num] = str(num)
        r[col_index(header, "Layer")] = layer
        r[col_index(header, "Material")] = "—"
        r[col_index(header, "Thickness_in")] = thick
        r[col_index(header, "Approx_R_Value")] = "0"
        r[col_index(header, "Layer_Type")] = "MISC"
        r[col_index(header, "Fill")] = "MISC"
        r[col_index(header, "Fastener_Icon")] = "none"
        r[i_ck] = ck
        r[i_cv] = cv
        r[i_note] = note
        return r

    insert_at = last_bld + 1
    next_num = int(rows[last_bld][i_num]) + 1
    extras = [
        bld_row(next_num, "Diagram Section Ref Width", "618", "Reference inner section width (px) for normalized zones"),
        bld_row(next_num + 1, "Diagram Section Ref Height", "700", "Reference inner section height (px)"),
        bld_row(next_num + 2, "Plan Ref Width", "432", "Reference plan width (px)"),
        bld_row(next_num + 3, "Plan Ref Height", "576", "Reference plan height (px)"),
    ]
    next_num += 4
    configs = [
        ("exterior_wall_assembly", "A4-06", "Schematic primary wall thickness"),
        ("structural_clt_core", "A4-04", "Core CLT strip in section"),
        ("interior_partition", "A4-10", "Partition thickness"),
        ("balcony_assembly", "A4-14", "Balcony assembly thickness"),
        ("system_id_prefix", "A4-", "Prefix for new system IDs in editor"),
    ]
    for ck, cv, note in configs:
        r = bld_row(next_num, "Configuration", "0", note, ck, cv)
        next_num += 1
        extras.append(r)

    rows[insert_at:insert_at] = extras

    # Apply seed to first data row per system
    for r in rows[1:]:
        sid = r[i_sys]
        if sid == "BLD" or sid not in seed:
            continue
        try:
            n = int(r[i_num])
        except ValueError:
            continue
        if r[i_num].strip().upper() == "TOTAL":
            continue
        if n != 1:
            continue
        s = seed[sid]
        r[i_so] = str(s["sheetOrder"])
        r[i_dl] = s["label"]
        r[i_dh] = s["hatch"]
        r[i_sj] = s["section"]
        r[i_pj] = s["plan"]
        r[i_vo] = s["viewOrientation"]
        r[i_vr] = s["viewReverse"]
        r[i_vt] = s["viewTopLabel"]
        r[i_vb] = s["viewBottomLabel"]

    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows(rows)
    print("Merged seed into", CSV_PATH)


if __name__ == "__main__":
    main()
