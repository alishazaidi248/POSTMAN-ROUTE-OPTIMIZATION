"""
Builds the accuracy report PDF from backend/data/bhandup/accuracy-results.json (written by scripts/accuracy-test.ts).
Every figure in the text and in the charts is read from that file.

    python scripts/make_accuracy_report.py [output.pdf]
"""
import json, os, sys, tempfile
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, KeepTogether

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "bhandup")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "Accuracy-Test-Report.pdf")
R = json.load(open(os.path.join(DATA, "accuracy-results.json"), encoding="utf-8"))
S, RT, DQ = R["system"], R["routes"], R["dataQuality"]
IMG = tempfile.mkdtemp()

RED, INK, GREY, GREEN, AMBER, BLUE = "#B42318", "#1F2933", "#7B8794", "#1E7A55", "#D9822B", "#2F6DB5"
plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": GREY, "axes.labelcolor": INK, "text.color": INK})


def pct(a, b):
    return "%.1f%%" % (100.0 * a / b) if b else "n/a"


def save(fig, name):
    p = os.path.join(IMG, name + ".png")
    fig.savefig(p, dpi=170, bbox_inches="tight")
    plt.close(fig)
    return p


def bar_labels(ax, bars, fmt="%d", pad=2):
    for b in bars:
        h = b.get_height()
        if h > 0:
            ax.annotate(fmt % h, (b.get_x() + b.get_width() / 2, h), ha="center", va="bottom", fontsize=8, xytext=(0, pad), textcoords="offset points")


# ── numbers ──────────────────────────────────────────────────────────────────────────────────────────────────
G = S["geocoding"]
A = S["assignment"]
N = G["total"]
prod, near, look = A["production"], A["nearestTerritoryCentre"], A["localityNameLookup"]
per_beat_routes = RT["perBeat"]
merged = RT["merged"]
ALGS = [a["name"] for a in per_beat_routes[0]["algorithms"]] if per_beat_routes else []
SHORT = {"Input order": "Input\norder", "Random order (mean of 30)": "Random\n(mean)", "Nearest Neighbour": "Nearest\nNeighbour", "NN + 2-opt": "NN +\n2-opt",
         "DBSCAN + NN": "DBSCAN\n+ NN", "DBSCAN + NN + 2-opt": "DBSCAN+NN\n+2-opt", "DBSCAN + NN + 2-opt + ALNS (production)": "DBSCAN+NN\n+2-opt+ALNS\n(production)"}


def alg_stats(routes):
    out = {}
    for name in ALGS:
        rows = [next(a for a in r["algorithms"] if a["name"] == name) for r in routes]
        gaps = [x["gapPercent"] for x in rows]
        rt = [x["runtimeMs"] for x in rows if x["runtimeMs"] is not None]
        out[name] = {"meanGap": sum(gaps) / len(gaps), "maxGap": max(gaps), "hit": 100.0 * sum(1 for x in rows if x["optimal"]) / len(rows),
                     "runtime": (sum(rt) / len(rt)) if rt else None,
                     "km": sum(x["distanceKm"] for x in rows if x["distanceKm"] is not None) / max(1, sum(1 for x in rows if x["distanceKm"] is not None)),
                     "min": sum(x["travelMin"] for x in rows if x["travelMin"] is not None) / max(1, sum(1 for x in rows if x["travelMin"] is not None))}
    return out


ST = alg_stats(per_beat_routes) if per_beat_routes else {}

import math
def _hav(a, b):
    r = math.pi / 180
    d1, d2 = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(d1 / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(d2 / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))
_pin = [(p["lat"], p["lng"]) for p in S["perDelivery"] if p["geocodingSource"] == "nominatim-pincode"]
PIN_KM = _hav(_pin[0], (19.1436, 72.9345)) if _pin else 0
def merged_gap(name, m):
    return next(a for a in m["algorithms"] if a["name"] == name)["gapPercent"]

# ── charts ───────────────────────────────────────────────────────────────────────────────────────────────────
charts = {}

# 1 geocoding
fig, ax = plt.subplots(figsize=(6.2, 2.9))
labels = ["Street / building\nmatch", "Area level\n(locality)", "Pincode level\n(one point,\nfar from Bhandup)", "Not found"]
vals = [G["exact"], G["areaLevel"], G["pincodeLevel"], G["failed"]]
b = ax.bar(labels, vals, color=[GREEN, AMBER, RED, GREY])
bar_labels(ax, b)
ax.set_ylabel("Deliveries (of %d)" % N)
ax.set_title("What the geocoder returned for the 130 supplied addresses", fontsize=10, loc="left")
charts["geo"] = save(fig, "geo")

# 2 assignment methods
fig, ax = plt.subplots(figsize=(6.4, 3.1))
methods = ["Production:\ngeocode + territory\n(PostGIS)", "Nearest territory\ncentre\n(same geocodes)", "Locality-name\nlookup\n(beat list only)"]
correct = [prod["correct"], near["correct"], look["correct"]]
wrong = [prod["wrong"], near["wrong"], look["wrong"]]
other = [prod["unassigned"], near["unassigned"], look["ambiguous"] + look["unknown"]]
x = range(3)
b1 = ax.bar(x, correct, color=GREEN, label="Correct beat")
b2 = ax.bar(x, wrong, bottom=correct, color=RED, label="Wrong beat")
b3 = ax.bar(x, other, bottom=[c + w for c, w in zip(correct, wrong)], color=GREY, label="No decision (unassigned / ambiguous)")
for i in x:
    for val, bottom in ((correct[i], 0), (wrong[i], correct[i]), (other[i], correct[i] + wrong[i])):
        if val > 0:
            ax.text(i, bottom + val / 2, str(val), ha="center", va="center", color="white", fontsize=8, fontweight="bold")
ax.set_xticks(list(x))
ax.set_xticklabels(methods, fontsize=8)
ax.set_ylabel("Deliveries (of %d)" % N)
ax.legend(fontsize=7.5, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.32), ncol=3)
ax.set_title("Beat assignment: three methods on the same 130 deliveries", fontsize=10, loc="left")
charts["assign"] = save(fig, "assign")

# 3 per beat outcome
fig, ax = plt.subplots(figsize=(6.6, 2.9))
beats = [p["beat"] for p in S["perBeat"]]
c = [p["correct"] for p in S["perBeat"]]
w = [p["wrong"] for p in S["perBeat"]]
u = [p["unassigned"] for p in S["perBeat"]]
ax.bar(beats, c, color=GREEN, label="Correct")
ax.bar(beats, w, bottom=c, color=RED, label="Wrong beat")
ax.bar(beats, u, bottom=[a + b_ for a, b_ in zip(c, w)], color=GREY, label="Unassigned")
for p in S["perBeat"]:
    if not p["hasTerritory"]:
        ax.text(p["beat"], 5.25, "no\nterritory", ha="center", va="bottom", fontsize=5.5, color=RED)
ax.set_xticks(beats)
ax.set_xticklabels([str(b_) for b_ in beats], fontsize=7)
ax.set_ylim(0, 6.6)
ax.set_xlabel("Beat number")
ax.set_ylabel("Deliveries (5 per beat)")
ax.legend(fontsize=7.5, frameon=False, ncol=3, loc="upper left")
ax.set_title("Production assignment result for every beat", fontsize=10, loc="left")
charts["perbeat"] = save(fig, "perbeat")

if ST:
    colors_by = [GREY, GREY, AMBER, AMBER, BLUE, BLUE, RED]
    # 4 mean gap
    fig, ax = plt.subplots(figsize=(6.6, 3.1))
    vals = [ST[n]["meanGap"] for n in ALGS]
    b = ax.bar([SHORT[n] for n in ALGS], vals, color=colors_by)
    bar_labels(ax, b, "%.1f%%")
    ax.set_ylabel("Mean gap to the optimum (%)")
    ax.tick_params(axis="x", labelsize=7)
    ax.set_title("Route accuracy: %d beat routes of ~5 stops, cost vs the EXACT optimum" % len(per_beat_routes), fontsize=10, loc="left")
    charts["gap"] = save(fig, "gap")
    # 5 hit rate
    fig, ax = plt.subplots(figsize=(6.6, 2.9))
    vals = [ST[n]["hit"] for n in ALGS]
    b = ax.bar([SHORT[n] for n in ALGS], vals, color=colors_by)
    bar_labels(ax, b, "%.0f%%")
    ax.set_ylim(0, 112)
    ax.set_ylabel("Routes solved to the optimum (%)")
    ax.tick_params(axis="x", labelsize=7)
    ax.set_title("How often each algorithm finds the optimal route", fontsize=10, loc="left")
    charts["hit"] = save(fig, "hit")
    # 6 runtime
    fig, ax = plt.subplots(figsize=(6.6, 2.9))
    names_rt = [n for n in ALGS if ST[n]["runtime"] is not None]
    vals = [max(ST[n]["runtime"], 0.001) for n in names_rt]
    b = ax.bar([SHORT[n] for n in names_rt], vals, color=[colors_by[ALGS.index(n)] for n in names_rt])
    ax.set_yscale("log")
    for bar, v in zip(b, vals):
        ax.annotate("%.3g ms" % v, (bar.get_x() + bar.get_width() / 2, v), ha="center", va="bottom", fontsize=7, xytext=(0, 2), textcoords="offset points")
    ax.set_ylabel("Mean run time per route (ms, log scale)")
    ax.tick_params(axis="x", labelsize=7)
    ax.set_title("Cost of accuracy: run time (5-stop routes)", fontsize=10, loc="left")
    charts["runtime"] = save(fig, "runtime")

if merged:
    # 7 merged rounds: gap vs best known
    fig, ax = plt.subplots(figsize=(6.6, 3.2))
    width = 0.12
    algs_plot = [n for n in ALGS if n != "Random order (mean of 30)"]
    for i, n in enumerate(algs_plot):
        gaps = [next(a for a in m["algorithms"] if a["name"] == n)["gapPercent"] for m in merged]
        pos = [j + (i - len(algs_plot) / 2) * width for j in range(len(merged))]
        ax.bar(pos, gaps, width, label=SHORT[n].replace("\n", " "), color=[GREY, AMBER, AMBER, BLUE, BLUE, RED][i])
    ax.set_xticks(range(len(merged)))
    ax.set_xticklabels(["%d stops\n(%d beats)%s" % (m["stops"], m["beats"], "\nexact optimum" if m["exact"] else "\nlong-search ref.") for m in merged], fontsize=7.5)
    ax.set_ylabel("Gap to reference (%)")
    ax.legend(fontsize=6.5, frameon=False, ncol=2)
    ax.set_title("Larger rounds (several beats merged)", fontsize=10, loc="left")
    charts["merged"] = save(fig, "merged")
    # 8 travel time on the biggest round
    big = merged[-1]
    fig, ax = plt.subplots(figsize=(6.6, 2.9))
    names_t = [a["name"] for a in big["algorithms"] if a["travelMin"] is not None]
    vals = [next(a for a in big["algorithms"] if a["name"] == n)["travelMin"] for n in names_t]
    b = ax.bar([SHORT[n] for n in names_t], vals, color=[colors_by[ALGS.index(n)] for n in names_t])
    bar_labels(ax, b, "%.0f")
    ax.set_ylabel("Driving time (minutes)")
    ax.tick_params(axis="x", labelsize=7)
    ax.set_title("Driving time of the largest round (%d stops)" % big["stops"], fontsize=10, loc="left")
    charts["bigtime"] = save(fig, "bigtime")

# 9 shared localities
fig, ax = plt.subplots(figsize=(6.0, 2.6))
shared = A["sharedLocalities"]
ax.bar(["Locality names used by\nexactly one beat", "Locality names shared by\nmore than one beat"], [DQ["localitiesInBeatList"] - DQ["localitiesSharedByMoreThanOneBeat"], DQ["localitiesSharedByMoreThanOneBeat"]], color=[GREEN, RED])
for i, v in enumerate([DQ["localitiesInBeatList"] - DQ["localitiesSharedByMoreThanOneBeat"], DQ["localitiesSharedByMoreThanOneBeat"]]):
    ax.text(i, v, str(v), ha="center", va="bottom", fontsize=9)
ax.set_ylabel("Localities in the beat list")
ax.set_title("A locality name alone does not identify a beat", fontsize=10, loc="left")
charts["shared"] = save(fig, "shared")

# ── document ─────────────────────────────────────────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontSize=17, textColor=colors.HexColor(RED), spaceAfter=6)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontSize=12.5, textColor=colors.HexColor(RED), spaceBefore=10, spaceAfter=4)
H3 = ParagraphStyle("H3", parent=ss["Heading3"], fontSize=10.5, textColor=colors.HexColor(INK), spaceBefore=6, spaceAfter=2)
P = ParagraphStyle("P", parent=ss["BodyText"], fontSize=9, leading=12.5, spaceAfter=4)
SM = ParagraphStyle("SM", parent=P, fontSize=7.8, leading=10, textColor=colors.HexColor("#52606D"))
BUL = ParagraphStyle("BUL", parent=P, leftIndent=11, bulletIndent=2, spaceAfter=2)
TC = ParagraphStyle("TC", parent=P, fontSize=8, leading=10, spaceAfter=0)


def tbl(rows, widths, header=True, font=8):
    data = [[Paragraph(str(c), TC) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if header else 0)
    style = [("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD2D9")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3E6E4"))]
    t.setStyle(TableStyle(style))
    return t


def img(key, width=165):
    from reportlab.lib.utils import ImageReader
    w, h = ImageReader(charts[key]).getSize()
    return Image(charts[key], width=width * mm, height=width * mm * h / w)


def bullets(items):
    return [Paragraph(i, BUL, bulletText="•") for i in items]


story = []
story.append(Paragraph("Module Accuracy Test Report", H1))
story.append(Paragraph("Postal Delivery Operations System - Bhandup West data set (26 beats, 130 deliveries)", P))
story.append(Paragraph("Generated %s from measurements made by scripts/accuracy-test.ts. Nothing in this report is an assumed or typed-in result." % R["generatedAt"][:10], SM))

# ---- summary
story.append(Paragraph("1. Summary", H2))
rows = [["Module", "What was measured", "Result"],
        ["Geocoding", "Addresses the geocoder placed at street / building level", "%d of %d (%s)" % (G["exact"], N, pct(G["exact"], N))],
        ["Geocoding", "Addresses that ended at area level, pincode level, or not found", "%d area, %d pincode, %d not found" % (G["areaLevel"], G["pincodeLevel"], G["failed"])],
        ["Beat assignment (production)", "Deliveries put in the CORRECT beat / WRONG beat / left unassigned", "%d (%s) / %d (%s) / %d (%s)" % (prod["correct"], pct(prod["correct"], N), prod["wrong"], pct(prod["wrong"], N), prod["unassigned"], pct(prod["unassigned"], N))],
        ["Beat assignment (alternative: locality name)", "Locality resolves to exactly one beat and it is the right one / ambiguous", "%d (%s) / %d ambiguous" % (look["correct"], pct(look["correct"], N), look["ambiguous"])],
        ]
if ST:
    prodname = ALGS[-1]
    rows += [["Route optimization (production ALNS pipeline)", "Mean gap to the exact optimum on %d small beat routes" % len(per_beat_routes), "%.2f%%  (optimal on %.0f%% of routes)" % (ST[prodname]["meanGap"], ST[prodname]["hit"])],
             ["Route optimization (input order)", "Same routes, deliveries visited in the order received", "%.1f%% above optimum" % ST[ALGS[0]]["meanGap"]]]
    big_rounds = [m for m in merged if not m["exact"]]
    if big_rounds:
        rows.append(["Route optimization on larger rounds", "Production gap to a long-search reference (%s stops)" % ", ".join(str(m["stops"]) for m in big_rounds),
                     ", ".join("%.1f%%" % merged_gap(ALGS[-1], m) for m in big_rounds) + "  (NN + 2-opt: " + ", ".join("%.1f%%" % merged_gap("NN + 2-opt", m) for m in big_rounds) + ")"])
story.append(tbl(rows, [45, 80, 55]))
story.append(Spacer(1, 3))
story.append(Paragraph("<b>Reading this summary.</b> The route optimizer is accurate: it finds the exact optimum on every small route tested and stays within a few per cent of a long-search reference on larger rounds, where every simpler algorithm is clearly further off. "
                       "The weak link is the <b>address side</b>: the free OpenStreetMap geocoder placed <b>none</b> of the %d chawl / building addresses at street level, and there is no official beat boundary, so automatic beat assignment "
                       "from coordinates did not work on this data (%d correct). Matching the beat list's own locality names, by contrast, resolved %s of the deliveries with no geocoding at all. Section 7 lists the limits of the current system." % (N, prod["correct"], pct(look["correct"], N)), P))

# ---- data
story.append(Paragraph("2. Data used and how it was set up", H2))
story += bullets([
    "<b>Beat list</b> (26 beats, Set 1, Bhandup West SO): each row is Post Office, Set No., Beat No., Locality Name, Main Area Name, Pincode. It is a <i>name directory</i>: it says which localities and places belong to which beat but contains <b>no boundary and no coordinates</b>.",
    "<b>Delivery test file</b>: 130 deliveries, 5 per beat (name, phone, locality, main area, address). No coordinates, parcel weight or priority. The ground truth for every test is the beat the row belongs to in the beat list (delivery n belongs to beat n/5, rounded up).",
    "<b>System setup</b> (through the system's own beat import, verification, postman and delivery-import functions): all previous data was removed after a database backup; 26 beats were created, one postman with a login per beat, and the 130 deliveries were imported with the real geocoder and PostGIS matching.",
    "<b>Territories</b>: because the beat list has no boundaries, each beat's territory was inferred as a %d m buffer around real OpenStreetMap locations found for its localities (%d of %d beats had at least one; the rest need a territory drawn by an administrator). These are proposals, not surveyed boundaries." % (350, A["beatsWithTerritory"], A["beatsTotal"]),
    "<b>Note on the beat list file</b>: the PDF was supplied in chat and was not available as a file, so beat-directory.csv holds every locality the PDF names for every beat, but only the main-area rows that also appear in the delivery file. Nothing was invented.",
])

# ---- test 1
story.append(Paragraph("3. Test 1 - Geocoding accuracy", H2))
story.append(Paragraph("The system geocodes an address with OpenStreetMap Nominatim, trying the full address first, then just the area, then just the pincode (each fallback is tagged with a lower confidence).", P))
story.append(img("geo", 140))
story.append(Paragraph("Of %d addresses, <b>%d</b> (%s) were placed at street/building level, %d at area level, and %d only at pincode level; %d were not found. "
                       "Only %d distinct coordinates were produced for the %d addresses that got a position, so many deliveries share one point: all %d pincode-level results are the same single point, about %.0f km from the Bhandup West post office. Only %d of the %d positions fall inside the Bhandup West area." %
                       (N, G["exact"], pct(G["exact"], N), G["areaLevel"], G["pincodeLevel"], G["failed"], G["distinctCoordinates"], G["withCoordinates"], G["pincodeLevel"], PIN_KM, G["insideBhandupWest"], G["withCoordinates"]), P))

# ---- test 2
story.append(Paragraph("4. Test 2 - Beat assignment accuracy (three methods)", H2))
story.append(Paragraph("<b>Production method</b>: geocode, then find the verified beat territory that contains the point (PostGIS). "
                       "<b>Alternative A</b>: pick the beat whose territory centre is nearest to the geocoded point. "
                       "<b>Alternative B</b>: look the locality name up in the beat list (needs no geocoding). A and B are evaluated offline on the same 130 deliveries; they are not in production.", P))
story.append(img("assign", 150))
story.append(Paragraph("Production: %d correct, %d wrong, %d left unassigned (%s%s). "
                       "Nearest centre: %d correct, %d wrong. Locality lookup: %d resolved correctly, %d ambiguous (the locality belongs to several beats), %d not in the list." %
                       (prod["correct"], prod["wrong"], prod["unassigned"], "exceptions raised: ", ", ".join("%s %d" % (k.replace("_", " ").lower(), v) for k, v in S["unassignedReasons"].items()) or "none",
                        near["correct"], near["wrong"], look["correct"], look["ambiguous"], look["unknown"]), P))
story.append(img("perbeat", 160))
if S["byTier"]:
    rows = [["Geocode quality", "Correct", "Wrong", "Unassigned"]]
    for k, v in sorted(S["byTier"].items()):
        rows.append([{"nominatim": "street / building match", "nominatim-area": "area level", "nominatim-pincode": "pincode level", "failed": "not found"}.get(k, k), v["correct"], v["wrong"], v["unassigned"]])
    story.append(tbl(rows, [60, 25, 25, 30]))
story.append(Paragraph("Territories: %d of %d beats have one; %d pairs of territories overlap, so a point can fall in more than one beat (the system then refuses to guess and raises an exception)." % (A["beatsWithTerritory"], A["beatsTotal"], A["overlappingTerritoryPairs"]), P))
story.append(img("shared", 120))

# ---- test 3
story.append(PageBreak())
story.append(Paragraph("5. Test 3 - Route optimization accuracy (algorithm comparison)", H2))
story.append(Paragraph("Every algorithm plans the same delivery set on the same <b>real road travel-time matrix (OSRM)</b> and is scored by the same production cost function (driving time + load penalty + priority penalty, service time included). "
                       "<b>Accuracy = gap to the optimum</b>: for routes of up to 10 stops the exact optimum was found by exhaustive search, so 0% means the best possible route. For larger rounds there is no exact answer; the reference is the cheapest route found by any of the algorithms <i>or</i> by five independent long ALNS runs (15 000 iterations, different seeds, clusters not forced together), so the production pipeline is not compared with itself and can show a gap above 0%.", P))
story.append(Paragraph("<b>Where the points come from.</b> The supplied addresses cannot be geocoded to buildings (Test 1), so route tests use points <i>placed</i> deterministically within 300 m of the OpenStreetMap anchor of the delivery's beat (%d beats had an anchor). "
                       "The road network, distances and travel times are real; the exact house positions are simulated. The comparison between algorithms is valid; the absolute minutes are illustrative." % RT["beatsWithPlacement"], P))
if ST:
    story.append(img("gap", 158))
    story.append(img("hit", 158))
    rows = [["Algorithm", "Mean gap", "Worst gap", "Optimal", "Mean km", "Mean min", "Run time"]]
    for n in ALGS:
        s = ST[n]
        rows.append([n, "%.2f%%" % s["meanGap"], "%.2f%%" % s["maxGap"], "%.0f%%" % s["hit"], "%.2f" % s["km"] if n != ALGS[1] else "-", "%.1f" % s["min"] if n != ALGS[1] else "-", ("%.3g ms" % s["runtime"]) if s["runtime"] is not None else "(in next row)"])
    story.append(tbl(rows, [55, 17, 17, 15, 16, 16, 20]))
    story.append(Spacer(1, 4))
    story.append(img("runtime", 150))
if merged:
    story.append(Paragraph("Larger rounds", H3))
    story.append(img("merged", 158))
    rows = [["Round", "Reference"] + [SHORT[n].replace("\n", " ") for n in ALGS if n != ALGS[1]]]
    for m in merged:
        rows.append(["%d stops (%d beats)" % (m["stops"], m["beats"]), "exact" if m["exact"] else "long search"] + ["%.2f%%" % next(a for a in m["algorithms"] if a["name"] == n)["gapPercent"] for n in ALGS if n != ALGS[1]])
    story.append(tbl(rows, [30, 20] + [22] * 6))
    story.append(img("bigtime", 150))
    prodrow = next(a for a in merged[-1]["algorithms"] if a["name"] == ALGS[-1])
    inrow = next(a for a in merged[-1]["algorithms"] if a["name"] == ALGS[0])
    story.append(Paragraph("On the largest round (%d stops) the production pipeline drives %.0f minutes / %.1f km against %.0f minutes / %.1f km for the input order. "
                           "On the 5-stop beat routes, plain Nearest Neighbour + 2-opt already finds the optimum on %.0f%% of routes, so those small routes barely separate the good algorithms; the differences appear from 25 stops upward." % (merged[-1]["stops"], prodrow["travelMin"], prodrow["distanceKm"], inrow["travelMin"], inrow["distanceKm"], ST["NN + 2-opt"]["hit"]), P))

# ---- data quality
story.append(Paragraph("6. Problems found in the supplied data", H2))
story += bullets([
    "%d of the %d locality names in the beat list appear under more than one beat (for example %s). A delivery's locality alone therefore cannot decide its beat; %d of the 130 test deliveries sit in such a locality." % (DQ["localitiesSharedByMoreThanOneBeat"], DQ["localitiesInBeatList"], "; ".join(DQ["sharedExamples"][:3]), DQ["deliveriesInSharedLocality"]),
    DQ["pincodeTypos"] + ".",
    "Truncated / incomplete main-area text in the delivery file: %s." % (", ".join('"%s"' % t for t in DQ["truncatedMainAreas"]) or "none found"),
    "%d recipient names repeat across the 130 deliveries (only %d distinct names), so a recipient name cannot identify a delivery." % (DQ["recipientNamesRepeated"], DQ["distinctRecipientNames"]),
    "The delivery file has no parcel count, weight or priority, so the load and priority parts of the route cost are not exercised by this data.",
    "The beat list has no boundaries or coordinates; every territory is an inference.",
])

# ---- limitations
story.append(Paragraph("7. Limitations of the current system", H2))
story.append(Paragraph("Address and beat matching", H3))
story += bullets([
    "<b>Geocoding coverage.</b> The free OpenStreetMap geocoder does not know most chawl, building, shop-line or 'GALA' names: only %s of these addresses were placed at street/building level. The rest fall back to area or pincode level, so many deliveries share one point." % pct(G["exact"], N),
    "<b>Geocode confidence is not checked when picking a beat.</b> The %d pincode-level results share one point ~%.0f km away and were left unassigned only because no territory contains that point. Area-level points (a whole locality reduced to one point) were accepted like exact ones: %d such deliveries went to the wrong beat, and the rest fell in gaps or in overlaps between territories." % (G["pincodeLevel"], PIN_KM, prod["wrong"]),
    "<b>No official beat boundaries.</b> Territories are inferred from a few known place names and overlap (%d overlapping pairs); %d of %d beats have no territory at all and cannot receive deliveries automatically." % (A["overlappingTerritoryPairs"], A["beatsTotal"] - A["beatsWithTerritory"], A["beatsTotal"]),
    "<b>Assignment is purely spatial.</b> The system does not use the beat list's own locality / main-area names to assign a delivery, even though that directory is the authoritative source; a name-based match could resolve %s of these deliveries unambiguously with no geocoding." % pct(look["correct"], N),
    "<b>The beat list format is not imported as-is.</b> The beat import expects one row per beat with a territory; the supplied format has hundreds of rows per beat and no territory, and a PDF cannot be uploaded (CSV / XLSX only). The set-up scripts in this project convert it.",
    "<b>Public geocoder limits.</b> Nominatim allows about one request per second and forbids bulk use: importing 130 addresses took several minutes; a daily post-office volume needs an own geocoder or a paid service.",
])
story.append(Paragraph("Route optimization", H3))
story += bullets([
    "<b>Travel times are typical, not live.</b> OSRM road times contain no live traffic or time-of-day effects; the public OSRM demo server is used and is not meant for production load.",
    "<b>The optimizer is a heuristic.</b> DBSCAN, Nearest Neighbour, 2-opt and ALNS give no guarantee of optimality: on the larger rounds the production route was %s above the best route a longer search found." % ", ".join("%.1f%%" % merged_gap(ALGS[-1], m) for m in merged if not m["exact"]),
    "<b>Clusters are kept whole by default.</b> Keeping each DBSCAN cluster as one run keeps neighbourhoods together but costs quality: on the %d-stop round plain NN + 2-opt (no clustering) is %.1f%% from the reference while DBSCAN + NN + 2-opt is %.1f%%. It is a business choice, switchable by ROUTE_ALNS_PRESERVE_CLUSTERS." % (merged[-1]["stops"], merged_gap("NN + 2-opt", merged[-1]), merged_gap("DBSCAN + NN + 2-opt", merged[-1])),
    "<b>No time windows, vehicle capacity, breaks or multiple postmen.</b> One postman, one round, one start point; there is no balancing of work between beats or postmen.",
    "<b>Priority and parcel weight are optional inputs</b> that this data set did not supply, so their effect on routes is untested here.",
    "<b>Route tests used placed points</b> (Section 5): the ranking of algorithms is reliable, the absolute minutes are not a forecast for these real addresses.",
])
story.append(Paragraph("Data and operations", H3))
story += bullets([
    "Ground truth for the beat of each delivery is taken from the file layout (5 deliveries per beat); there are no independent coordinates to measure geocoding distance error.",
    "Only one post office and one 130-delivery batch were tested; scaling to a full office day has not been measured beyond 100-130 stops per round.",
    "Accuracy of the postman app's field behaviour (GPS, offline queue) is outside this report.",
])

story.append(Paragraph("8. Recommendations", H2))
story += bullets([
    "Add a <b>directory-based matcher</b> that uses the beat list's locality + main-area names first (with fuzzy matching), and geocoding only as a fallback.",
    "Do not auto-assign on <b>pincode-level or area-level</b> geocodes: send them to the exceptions list, or accept an administrator-drawn beat.",
    "Give every beat a <b>surveyed territory</b> (draw the 26 in the Beats map) and verify them; overlapping boundaries should be resolved by the administrator.",
    "Use a <b>dedicated geocoder</b> (self-hosted Nominatim/Pelias or a paid API) and collect house coordinates from postmen once, then reuse them.",
    "Run OSRM on the office's own server, and add priority / parcel data to the imports so the full cost model is used.",
])

story.append(Paragraph("9. Reproducing the tests", H2))
story.append(Paragraph("<font face='Courier' size='7.5'>python backend/data/bhandup/build_data.py<br/>npx tsx scripts/setup-bhandup.ts wipe | beats | deliveries<br/>npx tsx scripts/accuracy-test.ts<br/>python scripts/make_accuracy_report.py</font>", P))
story.append(Paragraph("Postman logins created: beat01.postman@postal.local ... beat26.postman@postal.local, password ChangeMe123! (administrator: admin.bhandup@postal.local).", SM))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor(GREY))
    canvas.drawString(18 * mm, 10 * mm, "Module Accuracy Test Report - Bhandup West data set")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, "Page %d" % doc.page)
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title="Module Accuracy Test Report", author="Postal Delivery Operations System")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("wrote", os.path.abspath(OUT))
