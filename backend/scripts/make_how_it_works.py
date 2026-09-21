# -*- coding: utf-8 -*-
"""A short guide: what happens in the app and the backend, and how it works."""
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "How-The-System-Works.pdf")

RED = colors.HexColor("#B3202A")
DARK = colors.HexColor("#111827")
GREY = colors.HexColor("#4B5563")
LINE = colors.HexColor("#E5E7EB")
SOFT = colors.HexColor("#F5F6F8")
BLUE = colors.HexColor("#1D5F8F")

base = getSampleStyleSheet()
BODY = ParagraphStyle("Body", parent=base["Normal"], fontName="Helvetica", fontSize=9.6, leading=13.6, textColor=DARK, spaceAfter=5)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.6, leading=11.4, spaceAfter=0)
CELLB = ParagraphStyle("CellB", parent=CELL, fontName="Helvetica-Bold")
CELLH = ParagraphStyle("CellH", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
TITLE = ParagraphStyle("Title", parent=BODY, fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=RED, spaceAfter=2)
SUB = ParagraphStyle("Sub", parent=BODY, fontSize=10.5, textColor=GREY, spaceAfter=10)
H = ParagraphStyle("H", parent=BODY, fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=RED, spaceBefore=12, spaceAfter=4, keepWithNext=1)
BUL = ParagraphStyle("Bul", parent=BODY, leftIndent=13, bulletIndent=3, spaceAfter=2.5)


def P(t, s=BODY):
    return Paragraph(t, s)


def bullets(items):
    return [Paragraph(i, BUL, bulletText="\u2022") for i in items]


def table(rows, widths, header=True):
    data = []
    for r, row in enumerate(rows):
        style = CELLH if (header and r == 0) else CELL
        data.append([Paragraph(str(c), CELLB if (c_i == 0 and not (header and r == 0)) else style) for c_i, c in enumerate(row)])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        st.append(("BACKGROUND", (0, 0), (-1, 0), RED))
    t.setStyle(TableStyle(st))
    return t


def box(d, x, y, w, h, title, sub, fill):
    d.add(Rect(x, y, w, h, rx=5, ry=5, fillColor=fill, strokeColor=LINE, strokeWidth=0.8))
    d.add(String(x + w / 2, y + h - 15, title, textAnchor="middle", fontName="Helvetica-Bold", fontSize=9, fillColor=DARK))
    for i, line in enumerate(sub):
        d.add(String(x + w / 2, y + h - 28 - i * 10, line, textAnchor="middle", fontName="Helvetica", fontSize=7.4, fillColor=GREY))


def arrow(d, x1, y1, x2, y2):
    d.add(Line(x1, y1, x2, y2, strokeColor=GREY, strokeWidth=1))
    d.add(Polygon([x2, y2, x2 - 5 if x2 > x1 else x2 + 5, y2 + 3, x2 - 5 if x2 > x1 else x2 + 5, y2 - 3], fillColor=GREY, strokeColor=GREY))


def architecture():
    d = Drawing(170 * mm, 95)
    box(d, 0, 38, 150, 52, "Admin Panel", ["React + Vite", "beats, postmen,", "deliveries, map"], colors.HexColor("#E8F1F8"))
    box(d, 0, 0, 150, 34, "Postman App", ["Expo / React Native", "Home, list, map"], colors.HexColor("#E7F4EE"))
    box(d, 200, 10, 130, 66, "Backend API", ["Node + Express + TypeScript", "login and roles, validation,", "route planner, audit log"], colors.HexColor("#FBEEEE"))
    box(d, 380, 42, 100, 40, "PostgreSQL", ["+ PostGIS", "all business data"], colors.HexColor("#F5F6F8"))
    box(d, 380, 0, 100, 34, "OSRM", ["road times, road", "geometry"], colors.HexColor("#F5F6F8"))
    arrow(d, 150, 64, 200, 55)
    arrow(d, 150, 17, 200, 30)
    arrow(d, 330, 58, 380, 62)
    arrow(d, 330, 28, 380, 17)
    return d


def flow():
    d = Drawing(170 * mm, 20 * mm)
    labels = ["Deliveries", "Road time\nmatrix", "DBSCAN", "Nearest\nNeighbor", "2-opt", "ALNS", "Best route"]
    w, gap = 60, 12
    for i, lab in enumerate(labels):
        x = i * (w + gap)
        d.add(Rect(x, 8, w, 30, rx=4, ry=4, fillColor=RED if i in (2, 3, 4, 5) else SOFT, strokeColor=LINE))
        for j, line in enumerate(lab.split("\n")):
            d.add(String(x + w / 2, 27 - j * 10 if "\n" in lab else 20, line, textAnchor="middle", fontName="Helvetica-Bold", fontSize=7.6,
                         fillColor=colors.white if i in (2, 3, 4, 5) else DARK))
        if i < len(labels) - 1:
            arrow(d, x + w, 23, x + w + gap, 23)
    return d


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 10 * mm, "Postal Delivery Operations System - how it works")
    canvas.drawRightString(190 * mm, 10 * mm, "Page %d" % doc.page)
    canvas.restoreState()


story = []
story += [P("How the system works", TITLE), P("Postal Delivery Operations System: the admin panel, the postman app and the backend, in plain words.", SUB)]

story += [P("1. The big picture", H),
          P("Three programs work together. The <b>admin panel</b> is for post-office staff. The <b>postman app</b> is for the person on the "
            "street. The <b>backend</b> sits between them and the database, and is the only place where rules are applied and data is "
            "saved. Neither app keeps its own copy of the truth: they ask the backend and show what it says."),
          architecture(), Spacer(1, 4)]

story += [P("2. What each part does", H),
          table([
              ["Part", "Who uses it", "What it does"],
              ["Admin panel", "Administrators", "Uploads a beat list, draws and verifies beat territories on a map, imports and assigns deliveries, resolves assignment exceptions, "
                                                  "sets whether a delivery photo is required, manages postmen, reads reports and the audit log."],
              ["Postman app", "Postmen", "The delivery list in route order, the route map, Navigate, Start Delivery / Mark Delivered (with a photo when the post office requires one), "
                                          "works offline and syncs later, keeps a history, receives notifications."],
              ["Backend", "Both apps", "Login, roles and passwords, saving to PostgreSQL/PostGIS, matching addresses to beats, planning routes, storing proof photos privately, "
                                        "sending notifications, writing the audit log."],
              ["PostgreSQL + PostGIS", "Backend only", "Stores everything: post offices, beats, their localities and map polygons, postmen, deliveries, history, routes."],
              ["OSRM", "Backend only", "A road-routing service: real driving times between stops and the road line drawn on the map."],
          ], [32 * mm, 30 * mm, 108 * mm])]

story += [P("3. Life of a parcel", H)]
story += bullets([
    "<b>Arrives.</b> An admin adds a delivery, or imports a file. The address is tidied up so that \"Farid Nagar, Bhandup West, Mumbai\" and \"Farid Nagar Bhandup W Mumbai\" are recognised as the same place.",
    "<b>Matched to a beat - by the beat list first.</b> Each beat has a list of the localities it covers. The system scores every beat from named evidence (which locality matched, which main area, the pincode) and only assigns when one beat is clearly ahead. "
    "If two beats fit equally (for example a road that appears under two beats) or the evidence is weak, the parcel goes to <b>Assignment Exceptions</b> with a suggested beat, the confidence and the reason - never a guess.",
    "<b>The map point supports the match, it does not replace it.</b> A point that is only the middle of an area or a pincode can never assign a parcel. A precise (house-level) point can decide when the beat list has nothing to say, but only inside exactly one <i>verified</i> territory.",
    "<b>Routed.</b> The backend plans the postman's visiting order (section 5) and the app shows it as numbered stops.",
    "<b>Delivered.</b> The postman taps Start Delivery, then Mark Delivered - taking a photo first if the post office requires one. The backend checks the change is allowed and, where required, that the photo is there; it saves it with history and the audit log. "
    "The postman's phone position at the door also teaches the system where that address is.",
    "<b>Problems.</b> Recipient unavailable, wrong address and similar outcomes re-plan the route and can raise an exception for the admin.",
])

story += [P("4. Beats and verification", H),
          P("A beat is an area with one postman: the localities it covers and, optionally, a territory drawn on the map. An admin uploads a beat list (Excel or CSV, one row per beat or per beat and locality) and the panel "
            "walks through Upload, Validate, Review, Import: nothing is saved until the last step, every problem is shown and can be downloaded as a report, and no row is silently dropped. "
            "Territories are checked when saved (a valid shape, a sensible size and place, no unnoticed overlap with another beat: an overlap must be confirmed) and marked "
            "<b>Verified</b>, <b>Needs verification</b>, <b>Missing</b> or <b>Overlapping</b>. Only verified territories are used to place a parcel on the map.")]

story += [P("5. How the route is chosen", H),
          P("There is exactly one optimizer. It is not a setting, and neither the app nor the admin can change it."), flow(), Spacer(1, 4),
          table([
              ["Step", "What it does"],
              ["Road-time matrix", "Asks OSRM for the driving time between the start point and every stop. Answers are cached, so repeated plans do not "
                                   "call OSRM again."],
              ["DBSCAN", "Groups stops that are close <i>by road time</i> into neighbourhoods."],
              ["Nearest Neighbor", "Builds a first route: neighbourhood by neighbourhood, always going to the closest next stop."],
              ["2-opt", "Removes crossings by reversing stretches of the route, only when the cost really drops."],
              ["ALNS", "Repeatedly removes some stops and puts them back in better places (random, worst, related and cluster removal; greedy, regret-2 and "
                       "regret-3 insertion). Operators that work well are used more often, worse routes are sometimes accepted early on to escape dead ends, "
                       "and the best route ever seen is what is returned."],
          ], [32 * mm, 138 * mm]),
          Spacer(1, 4),
          P("Every step is scored with the <b>same cost</b>: driving time, plus a penalty for carrying a heavy bag over long legs, plus a penalty for making "
            "urgent parcels wait, with time spent at each door included. So a route can only be called better if that number is lower. "
            "In the latest test on the 130 real Bhandup West deliveries ALNS improved the 2-opt route by about 15 percent; on tiny routes of a few places it found nothing better, and says so. A route takes well under a second for 100 stops, so it is planned while you wait. The \"carrying a heavy bag\" part uses real parcel weights when they are known and is switched off when they are not. "
            "When a delivery is completed the route is only trimmed; a new delivery or a manual recalculation runs the whole pipeline again.")]

story += [P("6. Login, roles and safety", H)]
story += bullets([
    "Everyone signs in with a login; the backend issues short-lived tokens. A postman's identity always comes from the login, never from anything the app sends.",
    "<b>First sign-in:</b> an account made by someone else has a temporary password. The admin panel and the app show only a \"Choose a new password\" screen, and the backend refuses everything else, until it is changed.",
    "Roles: Super Admin (all post offices), Admin (their own post office only), Postman (only their own deliveries). Another office's data looks like it does not exist.",
    "<b>Delivery photos are private:</b> stored outside any public folder, readable only by that delivery's postman and the post office's administrators.",
    "Every important change is written to an audit log: who, what, when. The backend validates every request itself; the apps' buttons are a convenience, not the protection.",
])

story += [P("7. Data that survives", H),
          P("Beats, polygons, verification, postmen, photos, assignments, deliveries, statuses and routes are all in PostgreSQL. A browser refresh, "
            "a logout/login and a backend restart were each tested to leave them unchanged. The only thing kept on the phone is the queue of updates made while offline; "
            "it is sent when the connection returns, and if the server has moved on (for example an admin cancelled the parcel) the phone's stale change is "
            "not forced through: the postman is told instead.")]

story += [P("8. Running and testing it", H),
          table([
              ["What", "How"],
              ["Backend", "cd backend, then npm run dev (needs PostgreSQL with PostGIS and the .env values). Tests: npm test (unit) and npm run test:integration (a real PostGIS database)."],
              ["Admin panel", "cd frontend, then npm run dev (port 5173). Tests: npm test."],
              ["Postman app", "cd PostmanApp, then npx expo start --web, or open it on a phone with a development build. Tests: npm test."],
              ["Browser tests", "e2e/README.md: a real Chrome drives the admin panel and the app against a real backend (45 checks)."],
              ["Every push", "GitHub Actions runs the type checks, ESLint, all the tests above, the build and the browser tests."],
              ["Road routing", "OSRM_BASE_URL in the backend .env. Without it routes still work but use flagged straight-line estimates."],
          ], [32 * mm, 138 * mm]),
          Spacer(1, 4),
          P("Known limits: the real beat list is a PDF that is not read (CSV / Excel only); the accuracy figures for the test data are partly circular (the test file lists each delivery's own locality) so the hold-out figure is the fair one; "
            "time windows and OTP / signature proof are not built; notifications reach a phone only with a real device build. The public OSRM demo server is for development only.", SMALL if 'SMALL' in globals() else BODY)]

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                        title="How the Postal Delivery Operations System works", author="")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)
