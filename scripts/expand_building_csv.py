#!/usr/bin/env python3
"""Insert schema columns before Drawing_Note (one-time migration)."""
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "Building_Systems_Complete.csv"

EXTRA = [
    "Config_Key",
    "Config_Value",
    "Sheet_Order",
    "Diagram_Label",
    "Diagram_Hatch",
    "Diagram_Section_Zones_JSON",
    "Diagram_Plan_Zones_JSON",
    "View_Orientation",
    "View_Reverse",
    "View_Top_Label",
    "View_Bottom_Label",
]


def main() -> None:
    text = CSV_PATH.read_text(encoding="utf-8")
    lines = list(csv.reader(text.splitlines()))
    if not lines:
        raise SystemExit("empty csv")
    header = lines[0]
    if "Config_Key" in header:
        print("Already expanded:", CSV_PATH)
        return
    try:
        di = header.index("Drawing_Note")
    except ValueError as e:
        raise SystemExit("Drawing_Note column not found") from e
    new_header = header[:di] + EXTRA + [header[di]]
    out_rows = [new_header]
    for row in lines[1:]:
        if len(row) < len(header):
            row = row + [""] * (len(header) - len(row))
        elif len(row) > len(header):
            row = row[: len(header)]
        note = row[di] if di < len(row) else ""
        tail = row[di + 1 :] if di + 1 < len(row) else []
        new_row = row[:di] + [""] * len(EXTRA) + [note] + tail
        out_rows.append(new_row)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f, lineterminator="\n").writerows(out_rows)
    print("Expanded:", CSV_PATH, "rows:", len(out_rows))


if __name__ == "__main__":
    main()
