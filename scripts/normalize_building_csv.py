#!/usr/bin/env python3
"""Normalize Building_Systems_Complete.csv in place (schema, thickness, splits, order)."""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "Building_Systems_Complete.csv"

NEW_HEADER = [
    "System_ID", "System_Type", "Location", "Stack_Direction", "System_Name", "Category",
    "#", "Layer", "Material", "Thickness_in", "Approx_R_Value", "Connection", "Fastener",
    "Fastener_Size", "Layer_Type", "Fill", "Fastener_Icon", "Fastener_Spacing_OC_in",
    "Min_Edge_Dist_in", "Min_End_Dist_in", "Fastener_Pattern", "Typ_Module_Width_in",
    "Element_Spacing_OC_in", "Cavity_Depth_in", "Control_Joint_Spacing_ft", "Drawing_Note",
]

META: dict[str, tuple[str, str, str, str]] = {
    "BLD": ("building_dimensions", "", "", "Building Dimensions"),
    "A4-01": ("clt_connection_wall_floor", "typical", "special", "CLT Wall–Floor Connection"),
    "A4-02": ("clt_floor_acoustic_finish_stack", "typical", "slab_top_to_bottom", "CLT Floor Acoustic (Finish to CLT)"),
    "A4-03": ("clt_roof_assembly", "typical", "roof_exterior_to_interior", "CLT Roof Assembly"),
    "A4-04": ("clt_wall_core_structural", "typical", "wall_interior_to_exterior", "CLT Wall Core"),
    "A4-05": ("clt_connection_panel_to_panel", "typical", "wall_interior_to_exterior", "CLT Panel-to-Panel Connection"),
    "A4-06": ("envelope_wall_exterior_primary", "typical", "wall_interior_to_exterior", "Exterior Wall (Primary)"),
    "A4-07": ("slab_on_grade_interior", "typical", "slab_top_to_bottom", "Slab on Grade (Interior)"),
    "A4-08": ("opening_window_typical", "typical", "special", "Window Opening"),
    "A4-09": ("interior_ceiling_clt_batten", "typical", "slab_top_to_bottom", "CLT Ceiling (Batten Grid)"),
    "A4-10": ("interior_partition_wall_typical", "typical", "wall_interior_to_exterior", "Interior Partition"),
    "A4-11": ("interior_stair_assembly", "typical", "slab_top_to_bottom", "Stair Assembly"),
    "A4-12": ("edge_guardrail_typical", "typical", "special", "Guardrail at Edge"),
    "A4-13": ("clt_wall_courtyard_void", "courtyard_void", "wall_interior_to_exterior", "Courtyard Void Wall"),
    "A4-14": ("balcony_terrace_assembly", "balcony", "slab_top_to_bottom", "Balcony Terrace"),
    "A4-15": ("rainwater_cistern_courtyard", "typical", "special", "Rainwater to Cistern"),
    "A4-16": ("green_roof_planting_well", "typical", "slab_top_to_bottom", "Green Roof Planting Well"),
    "A4-17": ("passive_ventilation_void_stack", "courtyard_void", "special", "Passive Ventilation"),
    "A4-18": ("courtyard_tree_structural_planter", "courtyard", "slab_top_to_bottom", "Courtyard Tree Planter"),
    "A4-19": ("podium_transfer_slab", "podium", "slab_top_to_bottom", "Podium Transfer Slab"),
    "A4-20": ("foundation_footing_system", "typical", "slab_top_to_bottom", "Footing System"),
    "A4-21": ("foundation_wall_below_grade", "typical", "wall_interior_to_exterior", "Foundation Wall"),
    "A4-22": ("clt_connection_wall_base_concrete", "typical", "wall_interior_to_exterior", "CLT Wall Base to Concrete"),
    "A4-23": ("ceiling_acoustic_resilient_below_clt", "typical", "slab_top_to_bottom", "Acoustic Ceiling Below CLT"),
}


def norm_thickness(s: str, *, is_total: bool = False) -> str:
    if not s or s.strip() in ("—", "N/A"):
        return s.strip() if s else ""
    s = str(s).strip()
    if s == "TOTAL":
        return s
    low = s.lower()
    if low == "varies":
        return "48.0"
    if "dia" in low:
        m = re.match(r"([\d.]+)", s)
        return m.group(1) if m else "4.0"
    if "~" in s and "50.5" in s:
        return "50.5625"
    if "~" in s and "17.125" in s:
        return "17.125"
    if "~" in s and ("9" in s and "10.5" in s):
        return "9.75"
    if "~" in s and "14.375" in s:
        return "14.375"
    m = re.match(r"^([\d.]+)\s*[–-]\s*([\d.]+)", s)
    if m and "gap" not in low:
        a, b = float(m.group(1)), float(m.group(2))
        return str(round((a + b) / 2, 6))
    mx = re.match(r"^(\d+)\s*-\s*(\d+)\s*/\s*(\d+)$", s)
    if mx:
        w, n, d = int(mx.group(1)), int(mx.group(2)), int(mx.group(3))
        return str(round(w + n / d, 6))
    mf = re.match(r"^(\d+)\s*/\s*(\d+)$", s)
    if mf:
        return str(round(int(mf.group(1)) / int(mf.group(2)), 6))
    mp = re.match(r"^([\d.]+)\s*x", s, re.I)
    if mp:
        return mp.group(1)
    if re.match(r"^[\d.]+$", s.replace("–", "-")):
        return s
    nm = re.match(r"^([\d.]+)", s)
    return nm.group(1) if nm else s


def old_idx(h: list[str], name: str) -> int:
    return h.index(name)


def pack_new(sid: str, old_row: list[str], oi: dict[str, int], overrides: dict | None = None) -> list[str]:
    st, loc, sd, sname = META[sid]
    cat = old_row[oi["Category"]]
    tail = old_row[oi["Category"] + 1 :]
    if overrides:
        for k, v in overrides.items():
            ti = NEW_HEADER.index(k)
            # tail index: NEW_HEADER from # onward maps to tail
            # tail[0] is #, tail[1] Layer, ...
            nh_from_hash = NEW_HEADER.index("#")
            j = ti - nh_from_hash
            if 0 <= j < len(tail):
                t = list(tail)
                t[j] = v
                tail = t
    return [sid, st, loc, sd, sname, cat] + tail


def main() -> None:
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        old_rows = list(r)
    oh = old_rows[0]
    oi = {name: old_idx(oh, name) for name in oh}

    by_id: dict[str, list[list[str]]] = {}
    for row in old_rows[1:]:
        if not row or not row[0]:
            continue
        by_id.setdefault(row[0], []).append(row)

    out: list[list[str]] = [NEW_HEADER]

    # --- BLD ---
    for row in by_id["BLD"]:
        nr = pack_new("BLD", row, oi)
        ix = NEW_HEADER.index("Thickness_in")
        if nr[NEW_HEADER.index("#")] != "TOTAL":
            nr[ix] = norm_thickness(nr[ix])
        out.append(nr)

    def append_system_rows(sid: str, layer_rows: list[list[str]], total_row: list[str] | None = None) -> None:
        for lr in layer_rows:
            nr = pack_new(sid, lr, oi)
            if nr[NEW_HEADER.index("#")] != "TOTAL":
                nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
            out.append(nr)
        if total_row:
            tr = pack_new(sid, total_row, oi)
            out.append(tr)

    # --- A4-01 ---
    a01 = by_id["A4-01"]
    layers = [x for x in a01 if x[oi["#"]] != "TOTAL"]
    tot = next(x for x in a01 if x[oi["#"]] == "TOTAL")
    for lr in layers:
        ex = {}
        if "Varies by engineer" in lr[oi["Fastener_Size"]]:
            ex["Fastener_Size"] = "Per structural engineer"
        nr = pack_new("A4-01", lr, oi, ex if ex else None)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    out.append(pack_new("A4-01", tot, oi))

    # --- A4-02 (1–5 only) + note ---
    a02 = by_id["A4-02"]
    tot02 = next(x for x in a02 if x[oi["#"]] == "TOTAL")
    sum_t = 0.0
    sum_r = 0.0
    for lr in a02:
        if lr[oi["#"]] == "TOTAL":
            continue
        if int(lr[oi["#"]]) > 5:
            continue
        nr = pack_new("A4-02", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if lr[oi["#"]] == "5":
            dn = nr[-1]
            if "A4-23" not in dn:
                nr[-1] = (dn + " Resilient ceiling below CLT: see A4-23.").strip()
        out.append(nr)
        sum_t += float(nr[NEW_HEADER.index("Thickness_in")])
        sum_r += float(nr[NEW_HEADER.index("Approx_R_Value")] or 0)
    out.append(
        [
            "A4-02", META["A4-02"][0], META["A4-02"][1], META["A4-02"][2], META["A4-02"][3], "A",
            "TOTAL", "—", "—", str(round(sum_t, 4)), str(round(sum_r, 2)),
            "—", "—", "—", "—", "", "none", "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-23 from old A4-02 layers 6–8 ---
    a23_layers = [x for x in a02 if x[oi["#"]] not in ("TOTAL",) and int(x[oi["#"]]) >= 6]
    sum23 = 0.0
    sumr23 = 0.0
    for i, lr in enumerate(a23_layers, start=1):
        base = ["A4-23", "", "A", str(i)] + lr[oi["Layer"] :]
        # rebuild as old-shaped row for pack_new
        fake = [""] * len(oh)
        fake[oi["System_ID"]] = "A4-23"
        fake[oi["System_Name"]] = META["A4-23"][3]
        fake[oi["Category"]] = "C"
        fake[oi["#"]] = str(i)
        for j, name in enumerate(oh):
            if name in ("System_ID", "System_Name", "Category", "#"):
                continue
            if name in oi:
                fake[oi[name]] = lr[oi[name]]
        nr = pack_new("A4-23", fake, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if "A4-02" not in nr[-1]:
            nr[-1] = (nr[-1] + " See A4-02 for floor finish stack above CLT.").strip()
        out.append(nr)
        sum23 += float(nr[NEW_HEADER.index("Thickness_in")])
        sumr23 += float(nr[NEW_HEADER.index("Approx_R_Value")] or 0)
    out.append(
        [
            "A4-23", META["A4-23"][0], META["A4-23"][1], META["A4-23"][2], META["A4-23"][3], "C",
            "TOTAL", "—", "—", str(round(sum23, 4)), str(round(sumr23, 2)),
            "—", "—", "—", "—", "", "none", "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-03 split polyiso ---
    a03 = by_id["A4-03"]
    for lr in a03:
        if lr[oi["#"]] == "TOTAL":
            continue
        if lr[oi["Layer"]].startswith("Continuous Rigid"):
            for idx_split, (lay, th, note) in enumerate(
                [
                    (
                        "Rigid Insulation (Polyiso) — Layer 1",
                        "2.5",
                        "First staggered polyiso layer; offset joints min 12 in from Layer 2.",
                    ),
                    (
                        "Rigid Insulation (Polyiso) — Layer 2",
                        "2.5",
                        "Second layer; 16 in o.c. fasteners; stagger from Layer 1.",
                    ),
                ]
            ):
                fake = lr[:]
                fake[oi["#"]] = str(4 + idx_split)
                fake[oi["Layer"]] = lay
                fake[oi["Thickness_in"]] = th
                fake[oi["Approx_R_Value"]] = "15"
                fake[-1] = note
                nr = pack_new("A4-03", fake, oi)
                nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
                out.append(nr)
            continue
        fake = lr[:]
        if fake[oi["#"]].isdigit() and int(fake[oi["#"]]) >= 5:
            fake[oi["#"]] = str(int(fake[oi["#"]]) + 1)
        nr = pack_new("A4-03", fake, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    tot_t03 = 0.09375 + 0.25 + 2 + 2.5 + 2.5 + 0.125 + 5
    out.append(
        [
            "A4-03", META["A4-03"][0], META["A4-03"][1], META["A4-03"][2], META["A4-03"][3], "A",
            "TOTAL", "—", "—", str(round(tot_t03, 4)), "48", "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-04 + cross-ref ---
    for lr in by_id["A4-04"]:
        if lr[oi["#"]] == "TOTAL":
            out.append(pack_new("A4-04", lr, oi))
            continue
        nr = pack_new("A4-04", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if "CLT Structural Wall Panel" in nr[NEW_HEADER.index("Layer")] and "A4-06" not in nr[-1]:
            nr[-1] = (nr[-1] + " See A4-06 for same core in full envelope.").strip()
        out.append(nr)

    # --- A4-05 ---
    for lr in by_id["A4-05"]:
        nr = pack_new("A4-05", lr, oi)
        if nr[NEW_HEADER.index("#")] != "TOTAL":
            nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)

    # --- A4-06: interior→exterior by layer name (re-run safe); split combined track row if present ---
    a06_raw = [x for x in by_id["A4-06"] if x[oi["#"]] != "TOTAL"]
    Li = oi["Layer"]

    def a06_pick(pred) -> list[str]:
        hits = [r for r in a06_raw if pred(r)]
        if not hits:
            raise RuntimeError("A4-06: missing layer for predicate")
        return [c for c in hits[0]]

    interior_labels = [
        lambda r: r[Li].startswith("Structure / Interior"),
        lambda r: r[Li].startswith("Vapor Control Layer"),
        lambda r: r[Li] == "Continuous Insulation" and "mineral wool" in (r[oi["Material"]] or "").lower(),
        lambda r: r[Li].startswith("WRB / Air Barrier"),
        lambda r: r[Li].startswith("Rainscreen Furring"),
        lambda r: r[Li].startswith("Wood Cladding"),
        lambda r: r[Li].startswith("Ventilated Cavity"),
    ]
    seq: list[list[str]] = [a06_pick(p) for p in interior_labels]

    combined_track = next((r for r in a06_raw if "Screen Track +" in r[Li] or r[Li].startswith("Screen Track +")), None)
    if combined_track:
        old2 = [c for c in combined_track]
        hss = [c for c in old2]
        hss[oi["Layer"]] = "Screen Support Frame (HSS)"
        hss[oi["Material"]] = "Galvanized steel HSS support frame - primary structure for screen assembly"
        hss[oi["Thickness_in"]] = "2"
        hss[-1] = "First of two-part screen support; EPDM pad at bracket-to-CLT contact."
        trk = [c for c in old2]
        trk[oi["Layer"]] = "Sliding Screen Track Assembly"
        trk[oi["Material"]] = "Steel top track and bottom guide - bolted to HSS frame"
        trk[oi["Thickness_in"]] = "2"
        trk[-1] = "Coordinate with operable screen; outboard layer is corrugated screen."
        seq.extend([hss, trk])
    else:
        seq.append(a06_pick(lambda r: "Screen Support Frame (HSS)" in r[Li]))
        seq.append(
            a06_pick(
                lambda r: "Sliding Screen Track Assembly" in r[Li]
                and "corrugated" not in (r[Li] or "").lower()
            )
        )

    seq.append(a06_pick(lambda r: r[Li].startswith("Sliding Metal Screen") or "corrugated aluminum" in (r[Li] or "").lower()))

    for i, lr in enumerate(seq):
        lr = [c for c in lr]
        lr[oi["#"]] = str(i + 1)
        seq[i] = lr
        if "Varies by engineer" in lr[oi["Fastener_Size"]]:
            lr[oi["Fastener_Size"]] = "Per structural engineer"
        nr = pack_new("A4-06", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if nr[NEW_HEADER.index("Layer_Type")] == "CLT" and "Exposed CLT" in nr[NEW_HEADER.index("Material")]:
            if "A4-04" not in nr[-1]:
                nr[-1] = (nr[-1] + " CLT core matches A4-04.").strip()
        out.append(nr)
    tot6 = sum(float(norm_thickness(r[oi["Thickness_in"]])) for r in seq)
    r6 = sum(float(r[oi["Approx_R_Value"]] or 0) for r in seq)
    out.append(
        [
            "A4-06", META["A4-06"][0], META["A4-06"][1], META["A4-06"][2], META["A4-06"][3], "B",
            "TOTAL", "—", "—", str(round(tot6, 4)), str(round(r6, 2)), "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-07 note + numeric TOTAL ---
    sum7 = sumr7 = 0.0
    for lr in by_id["A4-07"]:
        if lr[oi["#"]] == "TOTAL":
            continue
        nr = pack_new("A4-07", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        sum7 += float(nr[NEW_HEADER.index("Thickness_in")])
        sumr7 += float(nr[NEW_HEADER.index("Approx_R_Value")] or 0)
        if "Structural Concrete Slab" in nr[NEW_HEADER.index("Layer")]:
            nr[-1] = (
                "Interior slab-on-grade typical only. Podium/parking: A4-19. Courtyard planter: A4-18. "
                "#4 rebar 2-way 18 in o.c.; 1.5 in min cover; control joints 10–12 ft o.c."
            )
        out.append(nr)
    out.append(
        [
            "A4-07", META["A4-07"][0], META["A4-07"][1], META["A4-07"][2], META["A4-07"][3], "B",
            "TOTAL", "—", "—", str(round(sum7, 4)), str(round(sumr7, 2)), "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-08 .. A4-10 (A4-09 TOTAL from sum of normalized layers) ---
    for sid in ("A4-08", "A4-09", "A4-10"):
        sum9 = sumr9 = 0.0
        for lr in by_id[sid]:
            if lr[oi["#"]] == "TOTAL":
                if sid == "A4-09":
                    out.append(
                        [
                            "A4-09", META["A4-09"][0], META["A4-09"][1], META["A4-09"][2], META["A4-09"][3], "C",
                            "TOTAL", "—", "—", str(round(sum9, 4)), str(round(sumr9, 2)), "—", "—", "—", "—", "", "none",
                            "", "", "", "", "", "", "", "", "", "—",
                        ]
                    )
                else:
                    nr = pack_new(sid, lr, oi)
                    if sid == "A4-08":
                        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
                    out.append(nr)
                continue
            nr = pack_new(sid, lr, oi)
            nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
            if sid == "A4-09":
                sum9 += float(nr[NEW_HEADER.index("Thickness_in")])
                sumr9 += float(nr[NEW_HEADER.index("Approx_R_Value")] or 0)
            out.append(nr)

    # --- A4-11 split riser ---
    a11 = by_id["A4-11"]
    n = 1
    for lr in a11:
        if lr[oi["#"]] == "TOTAL":
            continue
        if lr[oi["Layer"]].startswith("CLT or Solid Timber Riser"):
            for lay, mat, note in [
                ("Riser — CLT (typical)", "CLT riser panel - matte - countersunk", "Alternate: use one riser type per flight."),
                ("Riser — Solid Timber (alternate)", "Solid white oak riser - matte - countersunk", "Alternate to CLT riser."),
            ]:
                fake = lr[:]
                fake[oi["#"]] = str(n)
                n += 1
                fake[oi["Layer"]] = lay
                fake[oi["Material"]] = mat
                fake[-1] = note
                nr = pack_new("A4-11", fake, oi)
                nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
                out.append(nr)
            continue
        fake = lr[:]
        fake[oi["#"]] = str(n)
        n += 1
        nr = pack_new("A4-11", fake, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    # One riser layer nominal (alternate rows not additive)
    tot11 = 1.5 + 0.75 + 5 + 0.25 + 0.375
    out.append(
        [
            "A4-11", META["A4-11"][0], META["A4-11"][1], META["A4-11"][2], META["A4-11"][3], "C",
            "TOTAL", "—", "—", str(round(tot11, 4)), "7.685", "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-12 split infill ---
    a12 = by_id["A4-12"]
    n = 1
    for lr in a12:
        if lr[oi["#"]] == "TOTAL":
            continue
        if "Infill Panel" in lr[oi["Layer"]]:
            for lay, mat, lt, note in [
                ("Infill — Tempered Glass (typical)", "3/8 in tempered glass - M8 standoff clamps", "GLASS", "Use one infill type per bay; alternate: timber slats (next row)."),
                ("Infill — Timber Slats (alternate)", "Horizontal white oak slats - matte", "WOOD", "Alternate to glass; use one per bay."),
            ]:
                fake = lr[:]
                fake[oi["#"]] = str(n)
                n += 1
                fake[oi["Layer"]] = lay
                fake[oi["Material"]] = mat
                fake[oi["Thickness_in"]] = "0.375"
                fake[oi["Layer_Type"]] = lt
                fake[oi["Fill"]] = lt
                fake[-1] = note
                nr = pack_new("A4-12", fake, oi)
                out.append(nr)
            continue
        fake = lr[:]
        fake[oi["#"]] = str(n)
        n += 1
        nr = pack_new("A4-12", fake, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    tot12 = 2.5 + 2 + 0.375 + 0.375 + 0.25 + 5
    out.append(
        [
            "A4-12", META["A4-12"][0], META["A4-12"][1], META["A4-12"][2], META["A4-12"][3], "C",
            "TOTAL", "—", "—", str(round(tot12, 4)), "8.5", "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-13 reorder 5,4,3,2,1 ---
    a13 = [x for x in by_id["A4-13"] if x[oi["#"]] != "TOTAL"]
    m13 = {int(x[oi["#"]]): x for x in a13}
    for new_i, old in enumerate([5, 4, 3, 2, 1], start=1):
        x = m13[old][:]
        x[oi["#"]] = str(new_i)
        nr = pack_new("A4-13", x, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if new_i == 1:
            nr[-1] = (nr[-1] + " Interior CLT coordinates with A4-04 core.").strip()
        out.append(nr)
    tot13 = sum(float(norm_thickness(m13[i][oi["Thickness_in"]])) for i in [5, 4, 3, 2, 1])
    r13 = sum(float(m13[i][oi["Approx_R_Value"]] or 0) for i in [5, 4, 3, 2, 1])
    out.append(
        [
            "A4-13", META["A4-13"][0], META["A4-13"][1], META["A4-13"][2], META["A4-13"][3], "D",
            "TOTAL", "—", "—", str(round(tot13, 4)), str(round(r13, 2)), "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-14, A4-15 ---
    for lr in by_id["A4-14"]:
        nr = pack_new("A4-14", lr, oi)
        if nr[NEW_HEADER.index("#")] != "TOTAL":
            nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    for lr in by_id["A4-15"]:
        if lr[oi["#"]] == "TOTAL":
            tr = pack_new("A4-15", lr, oi)
            tr[NEW_HEADER.index("Thickness_in")] = "52.0"
            out.append(tr)
            continue
        nr = pack_new("A4-15", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if "Cistern" in nr[NEW_HEADER.index("Layer")] or "Overflow" in nr[NEW_HEADER.index("Layer")] or "Reuse" in nr[NEW_HEADER.index("Layer")]:
            nr[NEW_HEADER.index("Thickness_in")] = "48.0"
            if "Representative depth" not in nr[-1]:
                nr[-1] = (nr[-1] + " Representative depth for diagram; verify with civil/MEP.").strip()
        out.append(nr)

    # --- A4-16 split structural base ---
    a16 = by_id["A4-16"]
    n = 1
    for lr in a16:
        if lr[oi["#"]] == "TOTAL":
            continue
        if "CLT Deck / Structural Slab" in lr[oi["Layer"]]:
            for lay, mat, ltype, fill, th in [
                ("Structural Base — CLT Deck (typical)", "CLT panel (3–5 ply) - structural base", "CLT", "CLT", "5"),
                ("Structural Base — Concrete Slab (alternate)", "4 in cast-in-place concrete slab", "CONCRETE", "CONCRETE", "5"),
            ]:
                fake = lr[:]
                fake[oi["#"]] = str(n)
                n += 1
                fake[oi["Layer"]] = lay
                fake[oi["Material"]] = mat
                fake[oi["Layer_Type"]] = ltype
                fake[oi["Fill"]] = fill
                fake[oi["Thickness_in"]] = th
                fake[-1] = "Use one structural base type per location; deep courtyard soil: A4-18."
                nr = pack_new("A4-16", fake, oi)
                out.append(nr)
            continue
        fake = lr[:]
        fake[oi["#"]] = str(n)
        n += 1
        nr = pack_new("A4-16", fake, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    tot16 = 8 + 0.0625 + 3 + 0.75 + 0.0625 + 0.25 + 5
    out.append(
        [
            "A4-16", META["A4-16"][0], META["A4-16"][1], META["A4-16"][2], META["A4-16"][3], "D",
            "TOTAL", "—", "—", str(round(tot16, 4)), "6", "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-17 ---
    for lr in by_id["A4-17"]:
        if lr[oi["#"]] == "TOTAL":
            tr = pack_new("A4-17", lr, oi)
            tr[NEW_HEADER.index("Thickness_in")] = "18.0"
            out.append(tr)
            continue
        nr = pack_new("A4-17", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)

    # --- A4-18 ---
    for lr in by_id["A4-18"]:
        if lr[oi["#"]] == "TOTAL":
            tr = pack_new("A4-18", lr, oi)
            tr[NEW_HEADER.index("Thickness_in")] = "50.5625"
            out.append(tr)
            continue
        nr = pack_new("A4-18", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)

    # --- A4-19, 20 ---
    for lr in by_id["A4-19"]:
        if lr[oi["#"]] == "TOTAL":
            tr = pack_new("A4-19", lr, oi)
            tr[NEW_HEADER.index("Thickness_in")] = "56.0"
            out.append(tr)
            continue
        nr = pack_new("A4-19", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        if "Wear Surface" in nr[NEW_HEADER.index("Layer")]:
            nr[-1] = "Coordinate level changes with A4-07 (not parking/podium scope)."
        out.append(nr)

    for lr in by_id["A4-20"]:
        if lr[oi["#"]] == "TOTAL":
            tr = pack_new("A4-20", lr, oi)
            tr[NEW_HEADER.index("Thickness_in")] = "58.0"
            out.append(tr)
            continue
        nr = pack_new("A4-20", lr, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)

    # --- A4-21 reorder 4,1,2,3 ---
    a21 = [x for x in by_id["A4-21"] if x[oi["#"]] != "TOTAL"]
    m21 = {int(x[oi["#"]]): x for x in a21}
    for new_i, old in enumerate([4, 1, 2, 3], start=1):
        x = m21[old][:]
        x[oi["#"]] = str(new_i)
        nr = pack_new("A4-21", x, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    tot21 = sum(float(norm_thickness(m21[i][oi["Thickness_in"]])) for i in [4, 1, 2, 3])
    r21 = sum(float(m21[i][oi["Approx_R_Value"]] or 0) for i in [4, 1, 2, 3])
    out.append(
        [
            "A4-21", META["A4-21"][0], META["A4-21"][1], META["A4-21"][2], META["A4-21"][3], "A",
            "TOTAL", "—", "—", str(round(tot21, 4)), str(round(r21, 2)), "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # --- A4-22 split + reorder CLT first ---
    m22 = {int(x[oi["#"]]): x for x in by_id["A4-22"] if x[oi["#"]] != "TOTAL"}
    old22_2 = m22[2]
    membrane = old22_2[:]
    membrane[oi["#"]] = "4"
    membrane[oi["Layer"]] = "Peel-and-Stick Membrane Flashing"
    membrane[oi["Material"]] = "Peel-and-stick membrane flashing at concrete bearing - fully adhered"
    membrane[oi["Thickness_in"]] = "0.125"
    gasket = old22_2[:]
    gasket[oi["#"]] = "5"
    gasket[oi["Layer"]] = "Compressible Sill Gasket"
    gasket[oi["Material"]] = "Compressible sill gasket at wood plate"
    gasket[oi["Thickness_in"]] = "0.125"
    pieces22 = [m22[5], m22[4], m22[3], membrane, gasket, m22[1]]
    for new_i, x in enumerate(pieces22, start=1):
        rowv = [c for c in x]
        rowv[oi["#"]] = str(new_i)
        nr = pack_new("A4-22", rowv, oi)
        nr[NEW_HEADER.index("Thickness_in")] = norm_thickness(nr[NEW_HEADER.index("Thickness_in")])
        out.append(nr)
    tot22 = 5.5 + 1 + 1.5 + 0.125 + 0.125 + 6
    out.append(
        [
            "A4-22", META["A4-22"][0], META["A4-22"][1], META["A4-22"][2], META["A4-22"][3], "A",
            "TOTAL", "—", "—", str(round(tot22, 4)), "6.75", "—", "—", "—", "—", "", "none",
            "", "", "", "", "", "", "", "", "", "—",
        ]
    )

    # Pad rows; order systems by IDs present in this file (BLD first, then natural-ish sort)
    L = len(NEW_HEADER)

    def system_id_sort_key(sid: str) -> tuple:
        if sid == "BLD":
            return (0,)
        parts = re.split(r"(\d+)", sid)
        key: list = []
        for p in parts:
            if not p:
                continue
            if p.isdigit():
                key.append(int(p))
            else:
                key.append(p.lower())
        return (1, tuple(key))

    for i, row in enumerate(out):
        while len(row) < L:
            row.append("")
        out[i] = row[:L]

    by_sid: dict[str, list[list[str]]] = defaultdict(list)
    for row in out[1:]:
        by_sid[row[0]].append(row)
    sids_ordered = sorted(by_sid.keys(), key=system_id_sort_key)
    out_sorted = [out[0]]
    for sid in sids_ordered:
        out_sorted.extend(by_sid.pop(sid, []))
    for sid in sorted(by_sid.keys(), key=system_id_sort_key):
        out_sorted.extend(by_sid.pop(sid, []))
    out = out_sorted

    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows(out)
    print("Wrote", len(out), "rows to", CSV_PATH)


if __name__ == "__main__":
    main()
