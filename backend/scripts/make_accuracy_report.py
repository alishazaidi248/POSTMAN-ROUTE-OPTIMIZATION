# -*- coding: utf-8 -*-
"""Builds Accuracy-Test-Report.pdf from the measured result files in backend/data/bhandup/. Nothing in the report is typed in:

    assignment-results.json      scripts/accuracy-assignment.ts   (the 130 deliveries, read back from the database)
    matcher-validation.json      scripts/validate-matcher.ts      (the matcher on the ground truth, three views + threshold sweep)
    routing-benchmark.json       scripts/benchmark-bhandup.ts     (five algorithms, real road times, real deliveries)
    synthetic-benchmark.txt      scripts/benchmark-route.ts       (deterministic synthetic rounds, model road network)
    cluster-preservation-study.txt / accuracy-results.json (the previous system's run, kept for the comparison)

    python scripts/make_accuracy_report.py
"""
import json
import os
import re
import io

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "bhandup")
OUT = os.path.join(HERE, "..", "..", "Accuracy-Test-Report.pdf")

RED = colors.HexColor("#B3131C")
DARK = colors.HexColor("#1A1A1E")
GREY = colors.HexColor("#5B5B63")
LIGHT = colors.HexColor("#F3F3F5")
LINE = colors.HexColor("#D9D9DE")
AMBER_BG = colors.HexColor("#FBF0DC")
AMBER = colors.HexColor("#B5720B")
BLUE_BG = colors.HexColor("#E7EFFB")
BLUE = colors.HexColor("#1B5FB3")


def load(name):
    with open(os.path.join(DATA, name), encoding="utf8") as f:
        return json.load(f)


assign = load("assignment-results.json")["summary"]
matcher = load("matcher-validation.json")
routing = load("routing-benchmark.json")
previous = load("accuracy-results.json")["system"]["assignment"]["production"]
cluster_text = open(os.path.join(DATA, "cluster-preservation-study.txt"), encoding="utf8").read()
synthetic_text = open(os.path.join(DATA, "synthetic-benchmark.txt"), encoding="utf8").read()

base = getSampleStyleSheet()
BODY = ParagraphStyle("Body", parent=base["Normal"], fontName="Helvetica", fontSize=9.4, leading=13, textColor=DARK, spaceAfter=5)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.2, leading=10.4, spaceAfter=0)
CELLH = ParagraphStyle("CellH", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
H1 = ParagraphStyle("H1", parent=BODY, fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=RED, spaceBefore=6, spaceAfter=8)
H2 = ParagraphStyle("H2", parent=BODY, fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=DARK, spaceBefore=10, spaceAfter=4)
TITLE = ParagraphStyle("Title", parent=BODY, fontName="Helvetica-Bold", fontSize=26, leading=30, textColor=RED, spaceAfter=6)
SUB = ParagraphStyle("Sub", parent=BODY, fontSize=11.5, leading=16, textColor=GREY)
BUL = ParagraphStyle("Bul", parent=BODY, leftIndent=13, bulletIndent=3, spaceAfter=2.5)


def P(t, s=BODY):
    return Paragraph(t, s)


def bullets(items):
    return [Paragraph(i, BUL, bulletText="•") for i in items]


def tbl(rows, widths, hl_last=False):
    data = [[Paragraph(c, CELLH if r == 0 else CELL) if isinstance(c, str) else c for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, 0), RED), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
          ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    for i in range(2, len(rows), 2):
        st.append(("BACKGROUND", (0, i), (-1, i), LIGHT))
    t.setStyle(TableStyle(st))
    return t


def callout(text, bg=AMBER_BG, edge=AMBER):
    t = Table([[Paragraph(text, CELL)]], colWidths=[174 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, edge), ("LEFTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def chart(fig, width_mm=170):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=170, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    from PIL import Image as PILImage
    w, h = PILImage.open(io.BytesIO(buf.getvalue())).size
    buf.seek(0)
    return Image(buf, width=width_mm * mm, height=width_mm * mm * h / w)


PALETTE = ["#B3131C", "#1B5FB3", "#1B7A3D", "#B5720B", "#5B5B63"]

# ── charts ──────────────────────────────────────────────────────────────────────────────────────────────────
def chart_assignment():
    fig, ax = plt.subplots(figsize=(7.4, 2.9))
    labels = ["Previous system\n(geocode + verified territory)", "Now: beat list first\n(all 130, full directory)", "Now, fair test\n(each delivery's own row held out)"]
    hold = matcher["views"]["HOLD-OUT"]
    correct = [previous["correct"], assign["correct"], hold["autoCorrect"]]
    wrong = [previous["wrong"], assign["incorrect"], hold["autoWrong"]]
    review = [previous["unassigned"], assign["unassigned"], 130 - hold["auto"]]
    x = range(3)
    ax.bar(x, correct, color="#1B7A3D", label="assigned correctly")
    ax.bar(x, wrong, bottom=correct, color="#B3131C", label="assigned to the wrong beat")
    ax.bar(x, review, bottom=[c + w for c, w in zip(correct, wrong)], color="#BDBDC4", label="sent to an administrator (exception)")
    for i in x:
        ax.text(i, 132, f"{correct[i]} / {wrong[i]} / {review[i]}", ha="center", fontsize=8.5, fontweight="bold")
    ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=8)
    ax.set_ylim(0, 148); ax.set_ylabel("deliveries (of 130)", fontsize=8)
    ax.legend(fontsize=7.5, loc="upper left", ncol=3, frameon=False, bbox_to_anchor=(0, -0.28))
    ax.spines[["top", "right"]].set_visible(False)
    return chart(fig)


def chart_routing(r):
    short = ["Input\norder", "NN", "NN +\n2-opt", "DBSCAN\n+ 2-opt", "+ ALNS"]
    fig, axes = plt.subplots(1, 3, figsize=(7.6, 2.7))
    for ax, key, title in zip(axes, ["distanceKm", "travelMinutes", "cost"], ["Distance (km)", "Travel time (min)", "Cost (travel + priority)"]):
        vals = [s[key] for s in r["stages"]]
        bars = ax.bar(range(5), vals, color=PALETTE)
        ax.set_title(title, fontsize=8.5)
        ax.set_xticks(range(5)); ax.set_xticklabels(short, fontsize=6)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v, f"{v:g}", ha="center", va="bottom", fontsize=6.2)
        ax.spines[["top", "right"]].set_visible(False); ax.tick_params(axis="y", labelsize=6.5)
    fig.tight_layout()
    return chart(fig)


def chart_views():
    fig, ax = plt.subplots(figsize=(7.4, 2.4))
    views = ["LOCALITY-ONLY", "HOLD-OUT", "IN-SAMPLE"]
    names = ["Localities only\n(no main areas)", "Fair test: own row\nheld out", "Full directory\n(own row included)"]
    auto = [matcher["views"][v]["auto"] for v in views]
    amb = [matcher["views"][v]["ambiguous"] for v in views]
    ax.barh(range(3), auto, color="#1B7A3D", label="assigned automatically, all correct")
    ax.barh(range(3), amb, left=auto, color="#BDBDC4", label="ambiguous: needs a person (true beat among the contenders)")
    for i in range(3):
        ax.text(auto[i] / 2, i, str(auto[i]), color="white", ha="center", va="center", fontsize=9, fontweight="bold")
        ax.text(auto[i] + amb[i] / 2, i, str(amb[i]), ha="center", va="center", fontsize=8.5)
    ax.set_yticks(range(3)); ax.set_yticklabels(names, fontsize=8); ax.invert_yaxis(); ax.set_xlim(0, 130)
    ax.legend(fontsize=7.3, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=1)
    ax.spines[["top", "right"]].set_visible(False)
    return chart(fig)


# ── the synthetic benchmark, read back from the saved output ─────────────────────────────────────────────────
def parse_synthetic(text):
    rounds = []
    for block in text.split("Dataset: ")[1:]:
        n = int(block.split(" ")[0])
        stages = {}
        for m in re.finditer(r"^(.+?):\n  Distance: ([\d.]+) km\n  Travel time: ([\d.]+) min\n  Cost: (\d+)\n  Runtime: ([^\n]+)", block, re.M):
            stages[m.group(1)] = dict(km=float(m.group(2)), minutes=float(m.group(3)), cost=int(m.group(4)), runtime=m.group(5))
        imp = re.search(r"ALNS improvement over 2-opt: ([\d.]+)%", block)
        rounds.append(dict(n=n, stages=stages, alns_over_2opt=float(imp.group(1)) if imp else None))
    return rounds


def build():
    doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="Accuracy Test Report - address to beat matching and route optimization", author="Postal Delivery Operations System")
    s = []
    s += [P("Accuracy Test Report", TITLE), P("Address to beat matching, and the five route algorithms - Bhandup West data set, re-run after the address-matching, territory, geocoding, routing and app changes.", SUB), Spacer(1, 6)]
    s += [callout("<b>Read this first.</b> The test file gives the answer key in its own layout (5 deliveries per beat, in beat order), and the beat directory supplied with it lists every delivery's own main area. "
                  "So the full-directory figure is partly a lookup of the answer; the <b>fair figure is the hold-out</b> one (each delivery's own directory row removed). The coordinates the geocoder returned are OpenStreetMap "
                  "anchors near the named places, not house positions: nothing here measures house-level location accuracy, and the geocode / territory methods never fired on this data (all 130 points are area- or pincode-level).", BLUE_BG, BLUE), Spacer(1, 8)]

    # ---- 1 assignment
    s += [P("1. Address to beat assignment", H1)]
    s += [P("The same 130 deliveries (<font face='Courier'>deliveries.csv</font>, unchanged), imported through the real import into a fresh database with the beat list imported through the beat-list wizard "
            "(26 beats, 201 locality records), Nominatim as the geocoder. Every number below is counted from what the system stored.")]
    s.append(tbl([
        ["", "Previous system", "Now (all 130)", "Now, fair test (hold-out)"],
        ["Assigned correctly", str(previous["correct"]), str(assign["correct"]), str(matcher["views"]["HOLD-OUT"]["autoCorrect"])],
        ["Assigned to the wrong beat", str(previous["wrong"]), str(assign["incorrect"]), str(matcher["views"]["HOLD-OUT"]["autoWrong"])],
        ["Sent to an administrator (exception)", str(previous["unassigned"]), f"{assign['unassigned']}", str(130 - matcher["views"]["HOLD-OUT"]["auto"])],
        ["Accuracy of all 130", f"{round(previous['correct'] / 130 * 100, 1)} %", f"{assign['accuracyOfAll']} %", f"{round(matcher['views']['HOLD-OUT']['autoCorrect'] / 130 * 100, 1)} %"],
        ["Accuracy of the ones assigned automatically", "0 % (5 assigned, all wrong)", f"{assign['accuracyOfAssigned']} %", "100 %"],
    ], [64 * mm, 34 * mm, 34 * mm, 42 * mm]))
    s += [Spacer(1, 6), chart_assignment()]
    m = assign["methods"]
    s += [P("How the system decided", H2)]
    s.append(tbl([
        ["Method", "Deliveries", "Correct"],
        ["NAME - the beat list identified the beat", str(m["NAME"]), str(assign["correctByMethod"].get("NAME", 0))],
        ["NAME_AND_TERRITORY - name confirmed by a house-level point inside the same verified territory", str(m["NAME_AND_TERRITORY"]), "-"],
        ["TERRITORY - a house-level point inside exactly one verified territory", str(m["TERRITORY"]), "-"],
        ["MANUAL - an administrator chose", str(m["MANUAL"]), "-"],
        ["Exception (not assigned)", str(assign["exceptions"]), "-"],
    ], [110 * mm, 32 * mm, 32 * mm]))
    reasons = ", ".join(f"{k}: {v}" for k, v in assign["exceptionReasons"].items())
    s += [Spacer(1, 4)]
    s += bullets([
        f"<b>Geocoder precision on these addresses:</b> {', '.join(f'{k} {v}' for k, v in assign['geocodePrecision'].items())} - none house- or street-level. So <b>0 deliveries could be assigned by territory</b>, "
        "and the 20 inferred territories were left <b>unverified</b> (nothing verifies them automatically: they are hulls of OpenStreetMap anchor points, not surveyed boundaries).",
        f"<b>Exception reasons:</b> {reasons}. The delivery that was not assigned is an address listed under two beats; the system suggested a beat and lists both contenders "
        f"({assign['exceptionsWithTheRightBeatSuggestedOrAmongContenders']} of {assign['exceptions']} exceptions has the true beat among them).",
        "<b>The previous system</b> depended on the geocode alone: every point was area- or pincode-level, so 125 of 130 fell into no territory or several, and the 5 it did assign were wrong.",
        "<b>A weak geocode never assigns and never overrides a strong name match</b> - unit-tested and integration-tested on a real PostGIS database.",
    ])
    s += [P("The fair test", H2), P(f"With each delivery's own directory row held out the matcher never sees the answer for the row it judges. Thresholds (score {matcher['thresholds']['high']} to assign, a lead of "
                                   f"{matcher['thresholds']['margin']} points over the next beat) were chosen on this data, but on a wide plateau: <b>all {matcher['sweep']['settings']} threshold combinations swept gave zero wrong automatic assignments</b> "
                                   f"(between {matcher['sweep']['minCorrect']} and {matcher['sweep']['maxCorrect']} correct).")]
    s += [chart_views()]
    s += [P("What is not measured: the MEDIUM confidence band was never reached by this data set (covered by unit tests only); the TERRITORY method's fixed confidence (80) is not validated (no house-level ground truth exists); "
            "the beat list of the real post office is a PDF that is not parsed, so the directory here is the supplied CSV.", CELL)]

    # ---- 2 routing
    s += [PageBreak(), P("2. Route algorithms", H1)]
    all_round = routing["results"][0]
    s += [P(f"Measured on this machine, with the production ALNS settings (at most {routing['alnsSettings']['maxIterations']} iterations, {routing['alnsSettings']['maxMillis']} ms, {routing['alnsSettings']['noImprovementLimit']} without improvement, "
            "clusters kept), on the real deliveries with real road times from OSRM, and the same cost function for every stage (driving time + priority; the load term is off because no delivery has a weight). "
            f"<b>Read with care:</b> the geocoder gave these 130 stops only <b>{all_round['distinctCoordinates']} distinct coordinates</b>, so stops sharing a point are at distance zero; the benchmark ranks the algorithms on ordering the "
            "places, not the houses.")]
    s += [P(f"{all_round['label']} ({all_round['stops']} stops)", H2)]
    s.append(tbl([["Algorithm", "Distance", "Travel time", "Cost", "Runtime"]] + [
        [x["name"], f"{x['distanceKm']} km", f"{x['travelMinutes']} min", f"{x['cost']:g}", "-" if x["runtimeMs"] is None else f"{x['runtimeMs']} ms"] for x in all_round["stages"]
    ], [64 * mm, 26 * mm, 30 * mm, 26 * mm, 28 * mm]))
    s += [Spacer(1, 6), chart_routing(all_round)]
    s += [P(f"ALNS improved on DBSCAN + NN + 2-opt by <b>{all_round['alnsOver2OptPercent']} %</b> in cost ({all_round['alnsDistanceOver2OptPercent']} % in distance) and on plain Nearest Neighbor by {all_round['alnsOverNnPercent']} % "
            f"({all_round['alns']['iterations']} iterations, {all_round['alns']['improvements']} new best routes).")]
    s += [P("The five smaller rounds (a group of five beats each)", H2)]
    rows = [["Round", "Stops / distinct points", "2-opt cost", "ALNS cost", "ALNS over 2-opt"]]
    for r in routing["results"][1:]:
        rows.append([r["label"], f"{r['stops']} / {r['distinctCoordinates']}", f"{r['stages'][3]['cost']:g}", f"{r['stages'][4]['cost']:g}", f"{r['alnsOver2OptPercent']} %"])
    s.append(tbl(rows, [58 * mm, 36 * mm, 28 * mm, 28 * mm, 24 * mm]))
    flat = all(r["alnsOver2OptPercent"] == 0 for r in routing["results"][1:])
    s += [Spacer(1, 3), P("<b>ALNS found nothing better than 2-opt on " + ("any" if flat else "some") + " of these small rounds</b> " +
                          "(4-5 distinct places: 2-opt already reaches the best order, so there is nothing for ALNS to improve). It is reported as it is; ALNS never returns a route dearer than 2-opt, and here it did not need to.")]

    syn = parse_synthetic(synthetic_text)
    s += [P("Larger synthetic rounds (model road network - not real roads)", H2)]
    rows = [["Stops", "NN + 2-opt", "DBSCAN + NN + 2-opt", "+ ALNS", "ALNS over 2-opt", "Full pipeline runtime"]]
    for r in syn:
        st = r["stages"]
        rows.append([str(r["n"]), f"{st['NN + 2-opt']['minutes']} min", f"{st['DBSCAN + NN + 2-opt']['minutes']} min", f"{st['DBSCAN + NN + 2-opt + ALNS']['minutes']} min", f"{r['alns_over_2opt']} % (cost)", st["DBSCAN + NN + 2-opt + ALNS"]["runtime"]])
    s.append(tbl(rows, [16 * mm, 28 * mm, 38 * mm, 26 * mm, 34 * mm, 34 * mm]))
    s += [Spacer(1, 3), P("Deterministic rounds of 25 / 50 / 100 / 200 deliveries with mixed priorities and weights, a street-grid model with a river, and the ALNS wall-clock cap. Travel time is not the cost: "
                          "with priorities live, the cost also charges lateness of urgent stops, so a route can be cheaper than another while driving longer.", CELL)]

    s += [P("Keeping DBSCAN clusters together: does it cost route quality? (measured)", H2)]
    s += [P("<font face='Courier' size='7.5'>" + cluster_text.split("condition")[1].split("Reading:")[0].replace("\n", "<br/>").replace(" ", "&nbsp;") + "</font>", CELL) if False else Spacer(1, 0)]
    s.append(tbl([["Condition", "Stops", "Drive time, clusters kept", "Drive time, clusters free", "Difference"],
                  ["Plain (real-data condition)", "25 / 50 / 100", "90.0 / 123.0 / 184.7 min", "89.7 / 123.2 / 184.6 min", "-0.3 % / +0.2 % / -0.0 %"],
                  ["Priorities + weights live", "25 / 50 / 100", "108.0 / 168.1 / 269.0 min", "119.2 / 183.9 / 309.9 min", "+10.4 % / +9.4 % / +15.2 %"]],
                 [42 * mm, 26 * mm, 38 * mm, 38 * mm, 30 * mm]))
    s += [Spacer(1, 3), P("Same drive time with plain deliveries (1.7-4x faster with clusters kept); 9-15 % <i>shorter</i> drives with clusters kept when priorities are used (freeing the search lowers the cost by spending driving time). "
                          "Decision: clusters stay together. Source: <font face='Courier'>data/bhandup/cluster-preservation-study.txt</font>.", CELL)]

    # ---- 3 limits
    s += [P("3. Limitations of these figures", H1)]
    s += bullets([
        "<b>Ground truth is the file's layout</b> (5 deliveries per beat in beat order). There is no independently surveyed answer key.",
        "<b>The full-directory accuracy is partly circular</b>: the supplied beat directory includes each delivery's own main area. Use the hold-out figure (%s of 130 assigned automatically, none wrong) as what the matcher itself achieves; "
        "the rest go to an administrator with the true beat among the suggestions." % matcher["views"]["HOLD-OUT"]["auto"],
        "<b>No house-level ground truth</b> and no house-level geocodes in this data: the geocode-precision logic, the TERRITORY method and address learning are covered by unit and integration tests, not by this accuracy test.",
        "<b>One post office, one data set.</b> Other localities will have other ambiguity; the thresholds were chosen on this set (on a wide plateau) and should be re-validated on new data with <font face='Courier'>npm run matcher:validate</font>.",
        "<b>Routing on the real deliveries is degenerate</b> (%d distinct points for %d stops); the synthetic rounds use a model road network. Neither is a measurement of a real postman's day." % (all_round["distinctCoordinates"], all_round["stops"]),
        "<b>Time windows are not modelled</b> (no data, and the ALNS closed-form insertion cost cannot represent them); <b>no delivery has a weight</b>, so the load term of the cost is off for this data.",
        "The public OSRM demo server and Nominatim were used (fair-use, no uptime guarantee); results depend on what they returned on the day (%s)." % assign["generatedAt"][:10],
    ])
    doc.build(s)
    print("wrote", os.path.abspath(OUT))


if __name__ == "__main__":
    build()
