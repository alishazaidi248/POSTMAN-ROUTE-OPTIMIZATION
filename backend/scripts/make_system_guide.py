# -*- coding: utf-8 -*-
"""Builds Postal-Delivery-System-Guide.pdf: the system as it is today, quoting the measured result files in backend/data/bhandup/.

    python scripts/make_system_guide.py
"""
import json
import os
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, Preformatted, NextPageTemplate,
)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "bhandup")
OUT = os.path.join(HERE, "..", "..", "Postal-Delivery-System-Guide.pdf")

RED = colors.HexColor("#B3131C")
DARK = colors.HexColor("#1A1A1E")
GREY = colors.HexColor("#5B5B63")
LIGHT = colors.HexColor("#F3F3F5")
LINE = colors.HexColor("#D9D9DE")
BLUE = colors.HexColor("#1B5FB3")
BLUE_BG = colors.HexColor("#E7EFFB")
GREEN = colors.HexColor("#1B7A3D")
AMBER_BG = colors.HexColor("#FBF0DC")
AMBER = colors.HexColor("#B5720B")

base = getSampleStyleSheet()
BODY = ParagraphStyle("Body", parent=base["Normal"], fontName="Helvetica", fontSize=9.6, leading=13.6,
                      textColor=DARK, spaceAfter=5)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=8.2, leading=10.6, spaceBefore=3, spaceAfter=8)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.1, leading=10.3, spaceAfter=0)
CELLB = ParagraphStyle("CellB", parent=CELL, fontName="Helvetica-Bold")
CELLH = ParagraphStyle("CellH", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
H1 = ParagraphStyle("H1", parent=BODY, fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=RED,
                    spaceBefore=16, spaceAfter=8, keepWithNext=1)
H2 = ParagraphStyle("H2", parent=BODY, fontName="Helvetica-Bold", fontSize=13, leading=16.5, textColor=DARK,
                    spaceBefore=12, spaceAfter=5, keepWithNext=1)
H3 = ParagraphStyle("H3", parent=BODY, fontName="Helvetica-Bold", fontSize=10.4, leading=13.5, textColor=BLUE,
                    spaceBefore=8, spaceAfter=3, keepWithNext=1)
BUL = ParagraphStyle("Bul", parent=BODY, leftIndent=13, bulletIndent=3, spaceAfter=2.5)
CODE = ParagraphStyle("Code", parent=BODY, fontName="Courier", fontSize=7.9, leading=10, textColor=DARK)
COVER_T = ParagraphStyle("CoverT", parent=BODY, fontName="Helvetica-Bold", fontSize=30, leading=35, textColor=colors.white)
COVER_S = ParagraphStyle("CoverS", parent=BODY, fontName="Helvetica", fontSize=13, leading=18, textColor=colors.white)


def c(text):
    return '<font face="Courier" size="8.4">%s</font>' % text


def P(t, s=BODY):
    return Paragraph(t, s)


def bullets(items):
    return [Paragraph(i, BUL, bulletText="\u2022") for i in items]


def tbl(rows, widths, header=True, size=None, zebra=True):
    data = []
    for r, row in enumerate(rows):
        out = []
        for cell in row:
            if isinstance(cell, str):
                st = CELLH if (header and r == 0) else CELL
                out.append(Paragraph(cell, st))
            else:
                out.append(cell)
        data.append(out)
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), RED)]
    if zebra:
        for i in range(1 if header else 0, len(rows)):
            if (i % 2) == 0:
                style.append(("BACKGROUND", (0, i), (-1, i), LIGHT))
    t.setStyle(TableStyle(style))
    return t


def callout(text, bg=BLUE_BG, edge=BLUE):
    t = Table([[Paragraph(text, CELL)]], colWidths=[174 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def code(text):
    t = Table([[Preformatted(text, CODE)]], colWidths=[174 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT), ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


# ------------------------------------------------------------------ diagrams
def box(d, x, y, w, h, text, fill=colors.white, edge=RED, size=8, bold=False, lines=None):
    d.add(Rect(x, y, w, h, rx=4, ry=4, fillColor=fill, strokeColor=edge, strokeWidth=1))
    parts = lines if lines else [text]
    n = len(parts)
    for i, s in enumerate(parts):
        yy = y + h / 2 + (n - 1) * 5 - i * 10 - 3
        d.add(String(x + w / 2, yy, s, textAnchor="middle", fontName="Helvetica-Bold" if (bold and i == 0) else "Helvetica",
                     fontSize=size, fillColor=DARK))


def arrow(d, x1, y1, x2, y2, label=None):
    d.add(Line(x1, y1, x2, y2, strokeColor=GREY, strokeWidth=1.1))
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    a = 4.5
    p1 = (x2 - a * math.cos(ang - 0.45), y2 - a * math.sin(ang - 0.45))
    p2 = (x2 - a * math.cos(ang + 0.45), y2 - a * math.sin(ang + 0.45))
    d.add(Polygon([x2, y2, p1[0], p1[1], p2[0], p2[1]], fillColor=GREY, strokeColor=GREY))
    if label:
        d.add(String((x1 + x2) / 2, (y1 + y2) / 2 + 3, label, textAnchor="middle", fontName="Helvetica", fontSize=6.8, fillColor=GREY))


def architecture_diagram():
    d = Drawing(494, 250)
    box(d, 8, 178, 150, 56, "", fill=BLUE_BG, edge=BLUE, lines=["Admin Panel", "React + Vite (port 5173)", "post office staff"], bold=True, size=8)
    box(d, 8, 100, 150, 56, "", fill=BLUE_BG, edge=BLUE, lines=["Postman App", "Expo / React Native", "iOS, Android, web (8081)"], bold=True, size=8)
    box(d, 200, 120, 130, 100, "", fill=colors.white, edge=RED, lines=["Backend API", "Express, port 4000", "/api/v1", "JWT, roles, Zod"], bold=True, size=8)
    box(d, 372, 190, 114, 44, "", fill=AMBER_BG, edge=AMBER, lines=["PostgreSQL + PostGIS", "Prisma ORM"], bold=True, size=8)
    box(d, 372, 130, 114, 44, "", fill=colors.white, edge=GREY, lines=["Geocoder", "Nominatim or Google"], size=8)
    box(d, 372, 70, 114, 44, "", fill=colors.white, edge=GREY, lines=["OSRM road routing", "matrix + polyline"], size=8)
    box(d, 8, 22, 150, 44, "", fill=colors.white, edge=GREY, lines=["OpenFreeMap tiles", "OpenStreetMap basemap"], size=8)
    arrow(d, 158, 206, 200, 190)
    arrow(d, 158, 128, 200, 150)
    d.add(String(160, 196, "REST", fontName="Helvetica", fontSize=6.8, fillColor=GREY))
    d.add(String(150, 118, "REST + JWT", textAnchor="end", fontName="Helvetica", fontSize=6.8, fillColor=GREY))
    arrow(d, 330, 190, 372, 208)
    arrow(d, 330, 165, 372, 152)
    arrow(d, 330, 138, 372, 96)
    arrow(d, 83, 100, 83, 66)
    d.add(String(90, 80, "map tiles", fontName="Helvetica", fontSize=6.8, fillColor=GREY))
    d.add(String(247, 100, "Only the backend talks to the", textAnchor="middle", fontName="Helvetica-Oblique", fontSize=7.4, fillColor=GREY))
    d.add(String(247, 90, "database, geocoder and router", textAnchor="middle", fontName="Helvetica-Oblique", fontSize=7.4, fillColor=GREY))
    return d


def chain_diagram(labels, width=494, per_row=None, box_h=34, gap=14, size=7.6, fill=colors.white, edge=RED):
    n = len(labels)
    per_row = per_row or n
    rows = (n + per_row - 1) // per_row
    bw = (width - gap * (per_row - 1)) / per_row
    d = Drawing(width, rows * (box_h + 22))
    for i, lab in enumerate(labels):
        r, col = divmod(i, per_row)
        x = col * (bw + gap)
        y = (rows - 1 - r) * (box_h + 22) + 8
        lines = lab if isinstance(lab, list) else [lab]
        box(d, x, y, bw, box_h, "", fill=fill, edge=edge, lines=lines, size=size)
        if col < per_row - 1 and i < n - 1:
            arrow(d, x + bw, y + box_h / 2, x + bw + gap, y + box_h / 2)
    return d


# ------------------------------------------------------------------ document
class Doc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
                         title="Postal Delivery Operations System - System Guide",
                         author="Generated from the project source", subject="Backend, admin panel and Postman app", **kw)
        body = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        cover = Frame(0, 0, A4[0], A4[1], leftPadding=22 * mm, rightPadding=22 * mm, topPadding=95 * mm, bottomPadding=20 * mm, id="cover")
        self.addPageTemplates([PageTemplate(id="cover", frames=[cover], onPage=self.cover_page),
                               PageTemplate(id="body", frames=[body], onPage=self.body_page)])
        self._key = 0

    def cover_page(self, canv, doc):
        canv.saveState()
        canv.setFillColor(RED)
        canv.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
        canv.setFillColor(colors.HexColor("#7E0D14"))
        canv.rect(0, 0, A4[0], 60 * mm, stroke=0, fill=1)
        canv.restoreState()

    def body_page(self, canv, doc):
        canv.saveState()
        canv.setStrokeColor(LINE)
        canv.line(self.leftMargin, A4[1] - 14 * mm, A4[0] - self.rightMargin, A4[1] - 14 * mm)
        canv.setFont("Helvetica", 7.8)
        canv.setFillColor(GREY)
        canv.drawString(self.leftMargin, A4[1] - 11.5 * mm, "Postal Delivery Operations System - System Guide")
        canv.drawRightString(A4[0] - self.rightMargin, 10 * mm, "Page %d" % (doc.page - 1))
        canv.restoreState()

    def afterFlowable(self, fl):
        if isinstance(fl, Paragraph) and fl.style.name in ("H1", "H2"):
            import hashlib
            text = fl.getPlainText()
            key = "h" + hashlib.md5(text.encode("utf-8")).hexdigest()[:10]
            self.canv.bookmarkPage(key)
            level = 0 if fl.style.name == "H1" else 1
            self.notify("TOCEntry", (level, text, self.page - 1, key))




# ------------------------------------------------------------------ the measured results the guide quotes
def _load(name):
    with open(os.path.join(DATA, name), encoding="utf8") as f:
        return json.load(f)


ASSIGN = _load("assignment-results.json")["summary"]
MATCHER = _load("matcher-validation.json")
ROUTING = _load("routing-benchmark.json")
FULL = ROUTING["results"][0]
HOLD = MATCHER["views"]["HOLD-OUT"]
TESTS = _load("test-counts.json")


def build():
    doc = Doc(OUT)
    s = []

    # -------------------------------------------------------------- cover
    s += [P("Postal Delivery<br/>Operations System", COVER_T), Spacer(1, 10),
          P("System guide: the backend, the admin panel and the Postman field app - as they are today", COVER_S),
          Spacer(1, 40),
          P("How an address becomes a beat and a postman, how territories are checked, how routes are planned, and what is measured, tested and not done.", COVER_S),
          Spacer(1, 80),
          P("Generated from the source and the measured result files in the repository on %s" % ASSIGN["generatedAt"][:10], ParagraphStyle("cv", parent=COVER_S, fontSize=10.5)),
          NextPageTemplate("body"), PageBreak()]

    s.append(P("Contents", ParagraphStyle("TocTitle", parent=H1, spaceBefore=0)))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("t0", fontName="Helvetica-Bold", fontSize=10, leading=15, leftIndent=0, textColor=DARK),
        ParagraphStyle("t1", fontName="Helvetica", fontSize=9, leading=12.5, leftIndent=14, textColor=GREY),
    ]
    s += [toc, PageBreak()]

    # -------------------------------------------------------------- 1
    s += [P("1. What this system is", H1),
          P("The system runs a post office's delivery round from the moment a parcel list arrives to the moment a postman completes a delivery. "
            "Three parts share one backend and one PostgreSQL / PostGIS database, which is the only source of truth:")]
    s += bullets([
        "<b>Backend</b> - Express + TypeScript + Prisma. Owns the data and every rule: address matching, confidence thresholds, the status state machine, password rules, proof requirements, route planning, notifications.",
        "<b>Admin panel</b> - React + Vite for post office staff: beats and territories, imports, assignment exceptions, postmen, deliveries, the map. It displays and asks; it decides nothing the backend decides.",
        "<b>Postman app</b> - Expo / React Native: today's round in route order, navigation, status, proof photo, an offline queue with conflict handling, history, notifications.",
    ])
    s += [Spacer(1, 4), architecture_diagram(),
          P("<i>Figure 1. Both clients call the same REST API. Only the backend touches the database, the geocoder, the routing engine and Expo's push service.</i>", SMALL)]
    s += [P("The life of a delivery", H2)]
    s.append(chain_diagram([["Import", "CSV / XLSX"], ["Normalize", "the address"], ["Match the", "beat list"], ["Confidence", "HIGH / review"],
                            ["Geocode +", "verified territory"], ["Assign, or an", "exception"], ["Route", "planned"], ["Postman:", "photo, status"]], per_row=4, box_h=36, gap=16))
    s.append(P("<i>Figure 2. The order matters: the beat list comes first; a geocode supports it and decides alone only when it is precise and lies in exactly one verified territory. Anything uncertain becomes an assignment exception, never a guess.</i>", SMALL))

    # -------------------------------------------------------------- 2
    s += [P("2. Roles, access and security", H1),
          P("Three roles: SUPER_ADMIN (every post office), ADMIN (one post office), POSTMAN (their own deliveries). Every request carries a JWT; the role and post office in it decide what the caller sees, and the API - not the panels - enforces it "
            "(<font face='Courier'>resolvePostOfficeScope</font>, <font face='Courier'>assertOwnsResource</font>). A postman's own id is always derived from the token, never from anything the client sends.")]
    s += bullets([
        "<b>First sign-in.</b> An account created or reset by someone else has a <b>temporary password</b> (<font face='Courier'>mustChangePassword</font>). Its token carries a restriction: the server refuses every endpoint except reading who you are, changing the password and signing out (403 <font face='Courier'>PASSWORD_CHANGE_REQUIRED</font>). "
        "Both apps show a <i>Choose a new password</i> screen instead of the application. Changing it ends every other session. Rules: 10+ characters, a letter and a number, not the email name, not a well-known password. No password is written in the source; the seed prints a random one once.",
        "<b>Sign-in is rate-limited</b> (20 attempts per 15 minutes per address by default; <font face='Courier'>AUTH_RATE_LIMIT</font>). Passwords are hashed with argon2id; refresh tokens are stored hashed and rotated.",
        "<b>Proof photos are private.</b> They live in a folder that is never served as static files, under random names; the only way to read one is an authenticated request from the delivery's own postman or the post office's administrators (<font face='Courier'>Cache-Control: private, no-store</font>). The bytes are checked to be a real JPEG / PNG / WebP, whatever the file is called.",
        "<b>Audit log.</b> Logins, imports, verification, territory changes, assignment overrides, status changes, proof added, password changed, proof setting changed - who, what, when.",
    ])

    # -------------------------------------------------------------- 3
    s += [P("3. Data model (the tables that matter)", H1)]
    s.append(tbl([
        ["Table", "Holds"],
        ["PostOffice", "office, location, <font face='Courier'>proofMode</font> (NONE | PHOTO)"],
        ["Beat", "number, name, <font face='Courier'>boundary</font> geometry(Polygon, 4326), <font face='Courier'>verificationStatus</font> (VERIFIED / PENDING_VERIFICATION / NEEDS_REVIEW), who verified"],
        ["<b>BeatLocality</b>", "the beat directory: one row per (beat, locality, main area, pincode) with normalised forms - what an address is matched against"],
        ["Address", "the address, coordinates, <font face='Courier'>geocodingPrecision</font> (HOUSE / STREET / AREA / PINCODE / NONE), provider metadata, normalised key"],
        ["Delivery", "status, beat, postman, <font face='Courier'>weightKg</font>, priority, <font face='Courier'>assignmentMethod</font> / <font face='Courier'>assignmentConfidence</font> / <font face='Courier'>assignmentEvidence</font>"],
        ["AssignmentException", "reason, message, <font face='Courier'>suggestedBeatId</font>, confidence, location quality, evidence, resolution"],
        ["<b>AddressLocation</b> / AddressLocationSample", "address learning: the median point per learnable address, and every GPS sample with its accept / reject reason"],
        ["<b>DeliveryProof</b>", "the proof photo's metadata and private storage key (never the bytes, never a URL)"],
        ["<b>PushToken</b>, Notification", "phones registered for push; every message a user was sent (title, read time)"],
        ["Postman, PostmanBeatAssignment, Route, RouteStop, DeliveryAssignmentHistory, DeliveryStatusHistory, AuditLog, User, ...", "the operational records"],
    ], [58 * mm, 116 * mm]))
    s += [Spacer(1, 4), P("All schema changes are additive migrations in <font face='Courier'>backend/prisma/migrations</font> (no reset, no destructive change); CI checks that the migrations and the Prisma schema agree.", CELL)]

    # -------------------------------------------------------------- 4
    s += [PageBreak(), P("4. Address to beat matching", H1),
          P("The beat list comes first because it needs no coordinates and is what the post office actually knows: which localities each beat covers. Full detail and the validation are in <font face='Courier'>backend/ADDRESS_MATCHING.md</font>.")]
    s += [P("Normalization and score", H2)]
    s += bullets([
        "<b>Normalization</b>: case, punctuation, abbreviations (RD→ROAD, W→WEST, BLDG→BUILDING), spelling variants (NIVAS/NIWAS), dotted initials (L.B.S.→LBS), pincode. "
        "\"Farid Nagar, Bhandup West, Mumbai\" and \"Farid Nagar Bhandup W Mumbai\" become the same tokens.",
        "<b>Score</b> = named evidence, capped at 100: locality up to 60 (a whole segment 100 %, fuzzy 92 %, phrase 93 %, all words in one segment 75 %, partial 55 %), the delivery's own locality field +15, a main area up to 30, the post office's area +5, the pincode +5. "
        "Common words (ROAD, NAGAR) count for less; short words never match fuzzily; there is <b>no negative evidence</b> (the directory is incomplete).",
        "<b>Levels</b>: HIGH (score ≥ 65 and 15 points clear of the next beat), AMBIGUOUS (another beat within 15), MEDIUM (45-64), LOW, NONE. The thresholds were swept on the ground truth, not picked: <b>all %d combinations swept gave zero wrong automatic assignments</b>." % MATCHER["sweep"]["settings"],
    ])
    s += [P("Decision: name first, weak geocodes never override", H2)]
    s.append(tbl([
        ["Name evidence", "Location evidence", "Result"],
        ["HIGH", "none / area / pincode / street", "Assign - method NAME"],
        ["HIGH", "house-level, inside the same verified territory", "Assign - NAME_AND_TERRITORY"],
        ["HIGH", "house-level, inside a <i>different</i> verified territory", "Exception AMBIGUOUS_MATCH (a conflict for a person, not an override)"],
        ["MEDIUM", "usable location inside that beat's verified territory", "Assign - NAME_AND_TERRITORY"],
        ["MEDIUM / AMBIGUOUS", "otherwise", "Exception with the suggestion and the contenders"],
        ["LOW / NONE", "house-level, inside exactly one verified territory", "Assign - TERRITORY (confidence 80, not validated)"],
        ["LOW / NONE", "house-level, inside several / none", "Exception MULTIPLE_BEAT_MATCH / NO_BEAT_MATCH - never a random pick"],
        ["LOW / NONE", "area or pincode level", "Exception WEAK_LOCATION: \"Location could not be determined precisely enough to assign this delivery automatically.\""],
    ], [32 * mm, 62 * mm, 80 * mm]))
    s += [Spacer(1, 4)]
    s += bullets([
        "<b>Every automatic assignment is explained</b>: the method, the confidence and the evidence (which locality, which main area, how it matched, the location quality, the territories) are stored with the delivery and shown on its page.",
        "<b>Assignment Exceptions page</b>: delivery, recipient, address (each part once), suggested beat (<i>B20 - Farid Nagar</i>), confidence (<i>92% - High</i>), reason, location quality, and the actions <b>Assign</b> (accept the suggestion), <b>Choose Beat</b>, <b>Ignore</b>. "
        "A manual decision is recorded as MANUAL and is never overwritten by a re-run; a beat nobody covers keeps a <i>no postman</i> exception open.",
    ])

    # -------------------------------------------------------------- 5
    s += [P("5. Territories", H1),
          P("A beat's territory is a PostGIS polygon. The panel shows four indicators: <b>✓ Verified</b>, <b>⚠ Needs verification</b>, <b>❌ Missing territory</b> and <b>⚠ Overlapping B21</b> (a heavy dashed outline on the map). "
            "Only <b>verified</b> territories take part in matching; a pending one is a draft.")]
    s.append(tbl([
        ["Checked when a territory is saved", "Rule"],
        ["Valid shape", "PostGIS ST_IsValid - a self-intersecting outline is refused with PostGIS's reason"],
        ["Coordinates", "WGS84 longitude / latitude in range"],
        ["Size", "1 000 m² to 25 km²"],
        ["Position", "centre within 30 km of its post office (catches a swapped latitude / longitude)"],
        ["Overlap", "with any other active beat by more than 25 m²: refused with <i>\"Beat 30 overlaps Beat 20 (1,234 m²)\"</i> unless the administrator confirms it is intended (also required to verify an overlapping beat)"],
    ], [50 * mm, 124 * mm]))
    s += [Spacer(1, 4), P("An address inside two verified territories is an exception, never a random pick. <font face='Courier'>GET /beats/territory-report</font> gives the office's counts (verified / needs verification / missing / overlapping) and every overlapping pair. "
                          "Nothing infers \"verified\": the Bhandup West territories inferred from OpenStreetMap anchors are imported <i>pending</i>.")]

    # -------------------------------------------------------------- 6
    s += [P("6. Geocoding and address learning", H1),
          P("<font face='Courier'>GeocodingService</font> is provider-independent (Nominatim, Google, or <font face='Courier'>none</font>). A result carries the coordinates, the provider's confidence, the components it recognised and, above all, the <b>precision</b>: "
            "HOUSE (a building), STREET, AREA (the centre of a suburb), PINCODE (the centre of a postal area) or NONE. The precision comes from what the provider says the match <i>is</i>, capped by the query tier (a house-like match returned for a fallback \"area, city\" query is AREA).")]
    s += bullets([
        "Only HOUSE is strong evidence; AREA and PINCODE never assign anything. A pincode-level point is not routed (a postman cannot drive to the middle of a postal area): it is left out and reported.",
        "<b>Address learning.</b> A delivery completed with the postman's own fresh GPS fix teaches the system where that address is; the next delivery to it reuses the learned point before any geocoder is asked. "
        "A fix is accepted only with a stated accuracy of 50 m or better, within 1 km of an existing precise geocode, and within 150 m of what was learned so far; the stored point is the median; one sample is STREET quality, two that agree are HOUSE quality. "
        "Only an address with a house / unit number and at least two other words is learnable. Rejected samples are kept with the reason.",
    ])

    # -------------------------------------------------------------- 7
    s += [P("7. Beat-list import", H1),
          P("Workflow in the admin panel: <b>upload → validate → preview → map columns → review → import → verify</b>. The real Bhandup West list is a PDF, which is not parsed; the importer takes CSV / XLSX and does not assume a format "
            "(columns are recognised by common names and can be remapped). Two shapes: one row per beat, or one row per (beat, locality) where the rows of one beat number are ONE beat with several localities, stored as <font face='Courier'>BeatLocality</font> records (not opaque JSON).")]
    s += bullets([
        "The preview counts, before anything is written: rows, new beats, existing beats receiving localities, locality records, repeated rows, unknown post offices, missing beat numbers, invalid rows, beats with no locality or territory.",
        "<b>No row is silently discarded</b>: a repeated (beat, locality, main area) is listed as <i>Skipped</i> with the row it repeats; every problem row is in the downloadable report. After the import, deliveries waiting for a beat are matched against the new directory.",
    ])

    # -------------------------------------------------------------- 8
    s += [PageBreak(), P("8. Route optimization", H1),
          P("There is <b>one</b> production pipeline and no algorithm selector anywhere (API, panel or app):")]
    s.append(chain_diagram([["Road time", "matrix (OSRM)"], ["DBSCAN", "clusters"], ["Nearest", "Neighbor"], ["2-opt"], ["ALNS"], ["Best", "route"], ["OSRM road", "geometry"]], per_row=7, box_h=34, gap=10, size=7.2))
    s += [Spacer(1, 3)]
    s += bullets([
        "<b>Cost</b> = driving time + load penalty + priority penalty, with arrival times including service time. <b>Load is a real weight</b> (<font face='Courier'>Delivery.weightKg</font>): a parcel count is never treated as a weight; with no weights the load term is switched off and the route says so (<font face='Courier'>loadBasis: NONE</font>). "
        "Priority (HIGH 1, URGENT 3) is in the cost, the Nearest Neighbor key and the ALNS insertion delta - tested: an URGENT stop 315 s away goes before a NORMAL one 110 s away.",
        "<b>ALNS</b> (Ropke-Pisinger): destroy operators random / worst / related / cluster, repair operators greedy / regret-2 / regret-3, adaptive weights, simulated-annealing acceptance, the best route tracked separately (never dearer than the 2-opt route), exact O(1) insertion deltas from prefix / suffix sums.",
        "<b>Clusters stay together</b> (measured): with plain deliveries the drive time is the same with clusters kept or free (-0.3 % to +0.2 %) and 1.7-4x faster; with priorities and weights live, freeing the clusters gives a lower cost but a 9-15 % <i>longer</i> drive. Route quality is not hurt, so the default stays.",
        "<b>Time windows are not implemented</b>: they make lateness non-linear in the arrival time, which breaks the closed-form insertion cost that makes ALNS fast, and no data carries a window. Planning is <b>synchronous</b> (about 50 ms for 25 stops, 200 ms for 50, 800 ms for 100 and 850 ms for 200; ALNS capped at 1.5 s): a background job would add machinery for no visible gain at beat sizes.",
    ])

    # -------------------------------------------------------------- 9
    s += [P("9. The admin panel", H1)]
    s += bullets([
        "<b>Map</b> (Operations Map): beats with their territory state, search, draw / edit a territory, verify, upload a beat list; territory checks and the overlap confirmation are the server's.",
        "<b>Assignment Exceptions</b> as described above; <b>Deliveries</b> and the delivery page (status, history, how it was assigned with the evidence, the proof photo, fetched with the administrator's token); <b>Imports</b> and <b>Data quality</b>; <b>Postmen</b>; <b>Reports</b>; <b>Audit log</b>.",
        "<b>Dashboard</b>: counts, and the <i>Proof of delivery</i> setting of the post office (nothing extra, or a photo). With a photo required the server refuses DELIVERED without it - for the postman and for an administrator alike.",
        "<b>Forced first-login password change</b> as in section 2.",
    ])

    # -------------------------------------------------------------- 10
    s += [P("10. The Postman app", H1)]
    s += bullets([
        "<b>Tabs</b>: Home, Deliveries (Today | History), Map, Account. Addresses are shown once (<i>21 Farid Nagar / Bhandup West / Mumbai</i>); the tab-bar height follows the device's own bottom inset so the labels are never clipped.",
        "<b>Status</b> only through the server's state machine: an ASSIGNED parcel offers <i>Start Delivery</i>, never <i>Mark Delivered</i>.",
        "<b>Proof of delivery.</b> When the post office requires a photo, <i>Mark Delivered</i> opens the camera first (camera only), keeps the photo inside the app, and sends it before the status change; offline, the photo and the change are queued together and replayed photo-first. "
        "The postman's fresh GPS fix goes with the completed delivery for address learning. Not implemented: OTP (needs an SMS provider) and signature.",
        "<b>Offline.</b> One persistent queue for every change, replayed oldest first; a network failure stops the replay and keeps the rest; a rejected change is never forced (the app re-reads the server and shows a conflict with the reason). "
        "<b>History works offline</b> (the last first page per period is saved and marked as such) and its top lists every change not on the server yet: <i>Waiting to sync</i> or <i>Conflict</i>.",
        "<b>Notifications.</b> The backend stores a message and pushes it through Expo for: new assignments (batched when an import assigns many), an urgent delivery, a reassignment, a route change, a message from the office. The Notifications screen is the source of truth. "
        "Push to a device needs a real phone and a build with the project's push credentials, so it is <b>not verified here</b>; registration, sending and the handling of a dead token are tested against a fake of Expo's API.",
    ])

    # -------------------------------------------------------------- 11
    s += [P("11. Configuration", H1)]
    s.append(tbl([
        ["Variable", "Default", "Meaning"],
        ["DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET", "-", "required"],
        ["GEOCODING_PROVIDER", "nominatim", "nominatim | google (GOOGLE_GEOCODING_API_KEY) | none"],
        ["OSRM_BASE_URL", "empty", "road routing; empty = flagged straight-line estimates; the public demo server is for development"],
        ["ROUTE_ALNS_PRESERVE_CLUSTERS, ROUTE_ALNS_MAX_MS, ...", "true, 1500", "tune (never replace) the pipeline"],
        ["PUSH_ENABLED, EXPO_ACCESS_TOKEN, PUSH_BATCH_MS", "true, empty, 20000", "push through Expo; the token is a secret and optional; batching of assignment notifications"],
        ["MAX_PROOF_PHOTO_MB", "5", "proof photo size limit"],
        ["AUTH_RATE_LIMIT", "20", "sign-in attempts per 15 minutes per address"],
        ["SEED_PASSWORD", "random", "the seed's account password; printed once when not set"],
    ], [62 * mm, 30 * mm, 82 * mm]))

    # -------------------------------------------------------------- 12
    s += [P("12. Testing and CI", H1),
          P("Every number below is a result of running the suite on this code; CI (<font face='Courier'>.github/workflows/ci.yml</font>) runs the same commands on every push and pull request, with nothing skipped.")]
    s.append(tbl([
        ["Suite", "Result", "What it covers"],
        ["Backend unit (vitest)", "%d tests, %d files" % (TESTS["backendUnit"]["tests"], TESTS["backendUnit"]["files"]), "normalization, matcher, decision, ground-truth validation, learning, precision, import (structured lists, weights), routing / ALNS / clusters / priority / load, status machine, push, mocked-storage API tests"],
        ["Backend integration (real PostgreSQL + PostGIS)", "%d tests, %d files" % (TESTS["backendIntegration"]["tests"], TESTS["backendIntegration"]["files"]), "the whole assignment pipeline, territory validation and overlaps on PostGIS, proof (private storage, access control, enforcement), forced password change"],
        ["Admin panel (vitest)", "%d tests" % TESTS["admin"]["tests"], "territory indicators, exceptions page, forced password change, proof setting"],
        ["Postman app (jest)", "%d tests, %d suites" % (TESTS["app"]["tests"], TESTS["app"]["suites"]), "state machine, offline queue, sync and conflicts (incl. photo-first), history offline, address display, proof flow"],
        ["Browser tests (Chrome, real backend)", "%d checks" % TESTS["e2e"]["checks"], "admin sign-in, forced password change, beat upload, beat verification, delivery assignment and exceptions, postman sign-in, route order, delivery completion"],
    ], [50 * mm, 30 * mm, 94 * mm]))
    s += [Spacer(1, 4), P("Also: TypeScript strict checks on all three projects, ESLint on all three (0 errors), the Prisma migration/schema drift check, and <font face='Courier'>expo config</font>. "
                          "Regression coverage of the areas listed for the release: authentication, PostGIS, beat and delivery assignment, route optimization, the offline queue, conflict handling, status transitions and audit logging.", CELL)]

    # -------------------------------------------------------------- 13
    s += [P("13. What was measured", H1),
          P("The same 130 Bhandup West deliveries as before (<font face='Courier'>Accuracy-Test-Report.pdf</font> has the detail and the charts).")]
    s.append(tbl([
        ["", "Previous system", "Now (all 130)", "Fair test (own row held out)"],
        ["Correct / wrong / sent to an administrator", "0 / 5 / 125", "%d / %d / %d" % (ASSIGN["correct"], ASSIGN["incorrect"], ASSIGN["unassigned"]), "%d / %d / %d" % (HOLD["autoCorrect"], HOLD["autoWrong"], 130 - HOLD["auto"])],
        ["Accuracy of all 130", "0 %", "%s %%" % ASSIGN["accuracyOfAll"], "%.1f %%" % (HOLD["autoCorrect"] / 130 * 100)],
    ], [66 * mm, 32 * mm, 32 * mm, 44 * mm]))
    s += [Spacer(1, 4)]
    m = ASSIGN["methods"]
    s += bullets([
        "Methods used on the 130: NAME %d, NAME_AND_TERRITORY %d, TERRITORY %d, MANUAL %d, exceptions %d. The geocoder returned only area- or pincode-level points, so the geocode / territory methods never fired." % (m["NAME"], m["NAME_AND_TERRITORY"], m["TERRITORY"], m["MANUAL"], ASSIGN["exceptions"]),
        "<b>The full-directory figure is partly circular</b> (the test file's directory lists each delivery's own main area); the hold-out figure is what the matcher itself achieves. The coordinates are OpenStreetMap anchors, not house positions: this is not a measurement of house-level accuracy.",
        "Routing on real road times, %d stops on %d distinct points: input order %s km, Nearest Neighbor %s, NN + 2-opt %s, DBSCAN + NN + 2-opt %s, <b>+ ALNS %s km</b> (%s %% cheaper than 2-opt). On five small rounds (4-5 distinct places) ALNS found nothing better than 2-opt - reported as it is."
        % (FULL["stops"], FULL["distinctCoordinates"], FULL["stages"][0]["distanceKm"], FULL["stages"][1]["distanceKm"], FULL["stages"][2]["distanceKm"], FULL["stages"][3]["distanceKm"], FULL["stages"][4]["distanceKm"], FULL["alnsOver2OptPercent"]),
    ])

    # -------------------------------------------------------------- 14
    s += [PageBreak(), P("14. Known limitations", H1)]
    s += bullets([
        "<b>The real beat list is a PDF</b> and is not parsed; the importer takes CSV / XLSX. The beat directory used here is the supplied CSV (201 rows).",
        "<b>The accuracy test's ground truth is the file's own layout</b> and its directory includes each delivery's own locality: use the hold-out figure. There is no house-level ground truth, so the TERRITORY confidence (80), the geocode-precision rules and address learning are covered by tests, not validated on real positions. The MEDIUM confidence band was never reached by the test data.",
        "<b>Time windows</b> are not implemented (no data; they break the ALNS insertion closed form). <b>OTP and signature proof</b> are not implemented (no SMS provider; no requirement).",
        "<b>Push delivery to a phone</b> cannot be verified without a device and Expo's servers. The native map screen has not been run on a device in this environment; the web build of the app was exercised end to end in a browser.",
        "<b>OSRM and Nominatim</b> are external services (the public demo servers are development-only); without OSRM routes are flagged straight-line estimates.",
        "<b>Existing accounts</b> created before the forced-change feature keep their current passwords until an administrator resets them or sets <font face='Courier'>mustChangePassword</font> for them.",
        "<b>CI</b> runs on GitHub; its result is reported by GitHub after the push, not by this document.",
    ])
    s += [Spacer(1, 6), callout("This guide describes the system as it is today. Where something is not done (time windows, OTP, PDF parsing, push verification on a device), it says so.")]

    doc.multiBuild(s)
    print("wrote", OUT)


if __name__ == "__main__":
    build()
