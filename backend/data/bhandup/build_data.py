"""
Builds the Bhandup West test data set (run once; the outputs are committed next to this file):

  deliveries.csv        the 130 test deliveries (5 per beat) exactly as supplied
  beat-directory.csv    the beat list in the supplied layout (Post Office, Set No., Beat No., Locality Name,
                        Main Area Name, Pincode): one row per (beat, locality); a Main Area Name is filled in only
                        where the supplied delivery file names one
  osm-cache.json        raw OpenStreetMap (Overpass) answers used for the anchors
  locality-anchors.json real coordinates found in OpenStreetMap for localities / landmarks, with the OSM id
"""
import csv, json, os, sys, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PO = "Bhandup West So"

NAMES = ["Aarav Sharma", "Priya Patil", "Rohan Deshmukh", "Sneha Kulkarni", "Aditya Joshi", "Neha Pawar", "Vikram Shinde",
         "Pooja More", "Rahul Jadhav", "Ananya Mehta", "Siddharth Gupta", "Kavya Nair", "Akash Sawant", "Riya Chavan",
         "Nikhil Bhosale", "Isha Shah", "Kunal Mishra", "Tanvi Kadam", "Yash Thakur", "Simran Singh"]

# (locality, main area) for delivery 1..130. Beat = ceil(n / 5) (the file has 5 deliveries per beat).
ROWS = [
    ("JANTA MARKET", "CHOPRA CHAWL"), ("JANTA MARKET", "CHOPRA BLDG"), ("JANTA MARKET", "MAHENDRA SPLENDOUR"),
    ("JANTA MARKET", "G K W QUARTERS A,B,C,D,E,F,G"), ("MANGATRAM PETROL PUMP TO GANDHI NAGAR", "RUNWAL FOREST BUILDING 8 TOWER"),
    ("BARJOR BAUG", "FAIR"), ("BARJOR BAUG", "DENA BANK"), ("BARJOR BAUG", "MANGLA HOSPITAL"), ("BARJOR BAUG", "SHIVKRUPA PATPEDHI"), ("BARJOR BAUG", "FAIR SHOP"),
    ("L.B.S MARG BHANDUP WEST", "MANALI APT"), ("L.B.S MARG BHANDUP WEST", "PIPERMENT WALA COMPOUND"), ("L.B.S MARG BHANDUP WEST", "BHANDUP STATION ROAD"), ("L.B.S MARG BHANDUP WEST", "DEVDARSHAN BUILDING"), ("L.B.S MARG BHANDUP WEST", "GURUNANAK HIGH SCHOOL"),
    ("BHANDUP VILLAGE ROAD", "KASTGURI VIDYALAYA"), ("BHANDUP VILLAGE ROAD", "SHRIRAM VIDYALAYA"), ("BHANDUP VILLAGE ROAD", "BHANDUP NIGHT HIGH SCHOOL"), ("BHANDUP VILLAGE ROAD", "JANSEWA SANGH VIDYALAYA"), ("BHANDUP VILLAGE ROAD", "SATYAM APARTMENT 6 FLOOR"),
    ("VILLAGE ROAD", "SANTOSHI NAGAR SHOPLINE 1 TO 12"), ("VILLAGE ROAD", "SANTOSHI NAGAR CHAWL 1 TO 7"), ("VILLAGE ROAD", "GANESH NIWAS A,B,C"), ("VILLAGE ROAD", "BASANT BHUVAN"), ("VILLAGE ROAD", "SAI DARSHAN SOCIETY SHOPLINE"),
    ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "SHANGRILA BISCUIT COMPANY"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "CORPORA BUILDING 6 FLOOR"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "CORPORA SHOPLINE"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "BHARAT INDUSTRIAL ESTATE"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "FILIX TOWER 10 FLOORS"),
    ("L.B.S. ROAD, BHANDUP WEST", "GUARUDWARA ROYALS METAL"), ("L.B.S. ROAD, BHANDUP WEST", "RADHA BAUG 1 TO 15 GALA"), ("L.B.S. ROAD, BHANDUP WEST", "BHIM NAGAR ZOPADPATTI"), ("L.B.S. ROAD, BHANDUP WEST", "RIHAL COMPOUND 1 TO 30 GALA"), ("L.B.S. ROAD, BHANDUP WEST", "GALA SHOPPING LINE 1 TO 15"),
    ("LAKE ROAD", "AVTAR VILLA"), ("LAKE ROAD", "MANIK INDUSTRIAL COMPANY"), ("LAKE ROAD", "MAHARASHTRA WINE SHOP"), ("LAKE ROAD", "RAM KUTIR CHAWL"), ("LAKE ROAD", "SARVODYA FORGING COMPANY"),
    ("RAM NAGAR", "PANCHAM SHETH CHAWL"), ("RAM NAGAR", "LALA VAZIR"), ("RAM NAGAR", "R K GUPTA CHAWL"), ("RAM NAGAR", "SURAJ PURAN PANDEY CHAWL"), ("RAM NAGAR", "ASHTVINAYAK SOCIETY"),
    ("GOVIND NAGAR", "SHUKLA BHAVAN"), ("GOVIND NAGAR", "NOOR MOHMMAD CHAWL"), ("GOVIND NAGAR", "PUNJABI CHAWL"), ("GOVIND NAGAR", "NITYANAND NIWAS"), ("GOVIND NAGAR", "GAYAKWD SADAN"),
    ("GAONDEVI AREA", "NEHA NEX BUILDING 7 FLOORS"), ("GAONDEVI AREA", "PATULWADI ZOPADPATTI"), ("GAONDEVI AREA", "ZAKARIA NIWAS ZOPADPATTI"), ("GAONDEVI AREA", "ZAKARIA COMPANY GALA"), ("GAONDEVI AREA", "ZAKARIYA SHOPLINE"),
    ("BHATTIPADA", "BABU SHETTY CHAWL"), ("BHATTIPADA", "VIJAY SHANKAR SHUKLA CHAWL"), ("BHATTIPADA", "RAM LAKHAN SHUKLA CHAWL"), ("BHATTIPADA", "TULSI NIWAS/RAMA NIWAS"), ("BHATTIPADA", "KADAM CHAWL"),
    ("TANK ROAD", "R.R.REALITY BUILDING 4 FLOOR"), ("TANK ROAD", "WING 23 FLOORS"), ("TANK ROAD", "R L A TOWER 4 FLOOR"), ("TANK ROAD", "VAKRATUND PALACE A,B WING"), ("TANK ROAD", "DEVI MAHALAXMI COTTAGE"),
    ("J.M.ROAD, BHANDUP WEST", "JAGRUTI BHARAT DARSHAN C.H.S."), ("J.M.ROAD, BHANDUP WEST", "SHRI KRISHNA MAHAL"), ("J.M.ROAD, BHANDUP WEST", "MANGALDEEP C.H.S."), ("J.M.ROAD, BHANDUP WEST", "GURKHA CHAWL 1,2,3"), ("J.M.ROAD, BHANDUP WEST", "SONAR CHAWL 2"),
    ("SAI VIHAR", "SAMARTH VERNICA BLDG"), ("SAI VIHAR", "NAVNEET SADAN BLDG-3"), ("SAI VIHAR", "RAJARAM YADAV CHAWL"), ("SAI VIHAR", "PATIRAM YADAV CHAWL"), ("SAI VIHAR", "SUNDAR NIWAS"),
    ("SAI HILL", "SARVODAYA SHOPPING CENTER"), ("SAI HILL", "OM SHRI SOCIETY"), ("SAI HILL", "BAJARANG NIWAS"), ("SAI HILL", "ANAND NIWAS"), ("SAI HILL", "YASHODA SMRUTI CHAWL"),
    ("JAIDEV SINGH NAGAR", "KAML NIWAS CHAWL"), ("JAIDEV SINGH NAGAR", "SUKH SAGAR SOC."), ("JAIDEV SINGH NAGAR", "ARUNODAY TOWER A WING"), ("JAIDEV SINGH NAGAR", "ARUNODAY TOWER B WING"), ("JAIDEV SINGH NAGAR", "HEEN NIKETAN BLDG ABC"),
    ("MANGATRAM PETROL PUMP", "ROBIN AUTO"), ("MANGATRAM PETROL PUMP", "SAI WEIGHT BRIDGE"), ("MANGATRAM PETROL PUMP", "JAI HIND OIL MILL COMPANY"), ("MANGATRAM PETROL PUMP", "BOMBAY OIL MILLS CO."), ("MANGATRAM PETROL PUMP", "ADRAK COMPOUND"),
    ("MAHARASHTRA NAGAR", "UNDE NIWAS"), ("MAHARASHTRA NAGAR", "THAKKAR NIWAS"), ("MAHARASHTRA NAGAR", "NARAYAN NIWAS"), ("MAHARASHTRA NAGAR", "KALPANA NIWAS"), ("MAHARASHTRA NAGAR", "PANDURANG NIWAS"),
    ("FUGAVALA COMPOUND", "CHAWL NO 1 TO 9"), ("FUGAVALA COMPOUND", "SHOPLINE 1 TO 22"), ("FUGAVALA COMPOUND", "JAITUN BI ALI GOHAR CHAWL"), ("FUGAVALA COMPOUND", "SHIVKRUPA SAHAKAR SADAN"), ("FUGAVALA COMPOUND", "DUKAN LINE"),
    ("FARID NAGAR", "FARID CHAWL"), ("FARID NAGAR", "AFJAL CHAWL"), ("FARID NAGAR", "CHANDRA NIWAS"), ("FARID NAGAR", "SHAM KUNG CHAWL"), ("FARID NAGAR", "SHANKAR SADAN"),
    ("N.C. H COLONY", "NAVAL CANTEEN"), ("N.C. H COLONY", "ST XAVIERS SCHOOL"), ("N.C. H COLONY", "NAVAL BUILDING"), ("N.C. H COLONY", "BUILDING NO 152"), ("N.C. H COLONY", "BUILDING NO 181"),
    ("MANGATRAM PETROL PUMP TO GANDHI NAGAR", "MHADA COLONY BUILDING K - 4"), ("MANGATRAM PETROL PUMP TO GANDHI NAGAR", "MHADA COLONY BUILDING K - 5"), ("MANGATRAM PETROL PUMP TO GANDHI NAGAR", "MHADA COLONY BUILDING K - 6"), ("MANGATRAM PETROL PUMP TO GANDHI NAGAR", "MHADA COLONY BUILDING K - 7"), ("MANGATRAM PETROL PUMP TO GANDHI NAGAR", "MHADA COLONY BUILDING K - 8"),
    ("MULUND GOREGAON LINK ROAD", "PANCHSHEEL NAGAR ZOPADPATTI"), ("MULUND GOREGAON LINK ROAD", "VASUDEV CHAMBER 7 FLOOR"), ("MULUND GOREGAON LINK ROAD", "VASUDEV HEIGHT 22 FLOOR"), ("MULUND GOREGAON LINK ROAD", "RAJEEV GANDHI NAGAR ZOPADPATTI"), ("MULUND GOREGAON LINK ROAD", "PRATIK INDUSTRIAL ESTATE A,B"),
    ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "MUNAMA COMPOUND"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "ABDUL MAJEED CHAWL"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "UMAR COMPOUND"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "SHAHNAWAZ MANJIL"), ("BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "BARF WALI GALLI"),
    ("HAJARE CHAWL", "SUSHILA NIWAS CHAWL"), ("HAJARE CHAWL", "JADHAV CHAWL"), ("HAJARE CHAWL", "BHOSLE CHAWL"), ("HAJARE CHAWL", "MOHITE CHAWL"), ("HAJARE CHAWL", "CHAVAN CHAWL"),
]
assert len(ROWS) == 130, len(ROWS)

# Every locality the supplied beat list names for each beat (read from the supplied PDF).
BEAT_LOCALITIES = {
    1: ["ISHWAR NAGAR BHANDUP WEST", "JANTA MARKET", "MANGATRAM PETROL PUMP TO GANDHI NAGAR", "OPPOSITE JANTA MARKET"],
    2: ["BARJOR BAUG", "GAUTAM UDYOG BHUVAN", "NARVEKAR COMPOUND", "VILLAGE ROAD"],
    3: ["L.B.S MARG BHANDUP WEST", "STATION ROAD"],
    4: ["BHANDUP VILLAGE ROAD", "SUBHASH NAGAR", "DATTA MANDIR ROAD", "PUNJABI CHAWL"],
    5: ["VILLAGE ROAD", "KHANDELWAL MARG"],
    6: ["BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD"],
    7: ["L.B.S. ROAD, BHANDUP WEST"],
    8: ["LAKE ROAD", "TULSHIPADA"],
    9: ["RAM NAGAR", "KONDALKAR COMPOUND", "RAVTE COMPOUND 1", "RAVTE COMPOUND 2", "RAVTE COMPOUND3", "TANAJI WADI"],
    10: ["GOVIND NAGAR", "ZHIPRA COMPD", "GAVAND COMPD", "VAIBHAV CHOWK", "PANNALAL COMPOUND", "TEMBHIPADA", "PATKAR COMPOUND", "MILIND NAGAR", "SIDDHARTHA NAGAR, GAONDEVI ROAD"],
    11: ["GAONDEVI AREA", "TEMBHIPADA", "J.M. ROAD"],
    12: ["BHATTIPADA", "KESHAVJI NAGAR", "BHATTIPADA CROSS ROAD", "JANGAL MANGAL ROAD"],
    13: ["TANK ROAD", "GEETANJALI MARG", "S.P.S. MARG"],
    14: ["J.M.ROAD, BHANDUP WEST", "SARVODAYA NAGAR", "SARVODAYA NAGAR II", "GANESH NAGAR, NAVJEEVAN LINE", "ANAND NAGAR", "SANMAN SINGH ROAD"],
    15: ["GADHAV NAKA ASHOK KEDARE CHOUK", "SAI VIHAR", "RAMABAI AMBEDKAR NAGAR", "SAI HILL"],
    16: ["SAI HILL", "NARDAS NAGAR", "KRANTI NAGAR", "SHIVDARSHAN PATH", "SHIVAJI NAGAR", "GANESH NAGAR"],
    17: ["JAIDEV SINGH NAGAR", "SAWANT COMPOUND", "UTKARSH NAGAR", "UTKARSH NAGAR (SOUTH)", "KOKAN NAGAR"],
    18: ["MANGATRAM PETROL PUMP NO 1", "MANGATRAM PETROL PUMP", "KAJU TEKDI GANESH NAGAR", "SAHYADRI NAGAR", "SAMARTHA NAGAR"],
    19: ["MAHARASHTRA NAGAR", "JOKIM COMPOUND", "PRATAP NAGAR"],
    20: ["FUGAVALA COMPOUND", "PATHAN COLONY", "FARID NAGAR"],
    21: ["FARID NAGAR", "KAMBALE COMPOUND", "MUNSHI MAHAL", "HANUMAN NAGAR", "ASHOK TEKDI"],
    22: ["N.C. H COLONY"],
    23: ["MANGATRAM PETROL PUMP TO GANDHI NAGAR"],
    24: ["L.B.S. ROAD, BHANDUP WEST", "MULUND GOREGAON LINK ROAD", "SUBHASH NAGAR", "SHELAR COMPOUND", "MHADA COLONY"],
    25: ["BHANDUP POLICE CHOWKI TO SONAPUR LINK ROAD", "TULSHIPADA", "PRAKASH NAGAR", "DARGAH CROSS ROAD", "MILLAT NAGAR"],
    26: ["HAJARE CHAWL", "SAMARTH SEWA MANDAL", "RATNADIP SEVA SANGH", "AMBYACHI BHARNI"],
}


def write_csvs():
    with open(os.path.join(HERE, "deliveries.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Name", "Phone Number", "post_office", "locality", "main_area", "address", "city", "state", "pincode"])
        for i, (loc, area) in enumerate(ROWS):
            w.writerow([NAMES[i % 20], "98000%05d" % (i + 1), "Bhandup West SO", loc, area,
                        "%s, %s, Bhandup West, Mumbai, Maharashtra 400078" % (area, loc), "Mumbai", "Maharashtra", "400078"])
    seen_area = {}
    for i, (loc, area) in enumerate(ROWS):
        seen_area.setdefault((i // 5 + 1, loc), []).append(area)
    with open(os.path.join(HERE, "beat-directory.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Post Office", "Set No.", "Beat No.", "Locality Name", "Main Area Name", "Pincode"])
        for beat, locs in BEAT_LOCALITIES.items():
            for loc in locs:
                for a in (seen_area.get((beat, loc)) or [""]):
                    w.writerow([PO, 1, beat, loc, a, 400078])


# key -> regex on the OSM "name" tag (case-insensitive) inside the Bhandup West box
ANCHOR_QUERIES = {
    "ISHWAR NAGAR BHANDUP WEST": "^Ishwar Nagar$",
    "MANGATRAM PETROL PUMP": "^Mangatram Petrol Pump$",
    "SUBHASH NAGAR": "^Subhash Nagar$",
    "DATTA MANDIR ROAD": "^Datta Mandir Rd$",
    "LAKE ROAD": "^Lake Road$",
    "TANAJI WADI": "^Tanajiwadi$",
    "GOVIND NAGAR": "^Govind Nagar$",
    "MILIND NAGAR": "^Milind Nagar$",
    "TEMBHIPADA": "^Tembhipada$",
    "GAONDEVI AREA": "^Gaondevi Mandir$",
    "BHATTIPADA": "^Bhattipada$",
    "JANGAL MANGAL ROAD": "^Jangal Mangal Road$",
    "TANK ROAD": "^Tank Road$",
    "SARVODAYA NAGAR": "^Sarvodaya Nagar$",
    "GANESH NAGAR": "^Ganesh Nagar$",
    "SAI HILL": "^Sai Hill Road$",
    "SAI VIHAR": "^Sai Vihar Path$",
    "KOKAN NAGAR": "^Kokan Nagar$",
    "MAHARASHTRA NAGAR": "^Maharashtra Nagar Road$",
    "PRATAP NAGAR": "^Pratap Nagar$",
    "FARID NAGAR": "^Farid Nagar$",
    "HANUMAN NAGAR": "^Hanuman Nagar$",
    "PRAKASH NAGAR": "^Prakash Nagar$",
    "KANJUR STATION ROAD": "^Kanjur Station Road$",
    "FORTIS HOSPITAL": "^Fortis Hospital$",
    "RUNWAL GREEN": "^Runwal Green",
    "RUNWAL FOREST": "^Runwal Forest$",
    "BHANDUP POLICE STATION": "Bhandup.*(Police|Chowki)",
    "SONAPUR": "Sonapur",
    "AMBEDKAR NAGAR": "^Ambedkar Nagar$",
    "MILLAT NAGAR": "Millat",
    "KHANDELWAL": "Khandelwal",
    "JANTA MARKET": "Janta",
    "BARJOR": "Barjor|Bhandup Market|Bhandup Bazaar",
    "SHIVAJI NAGAR": "^Shivaji Nagar$",
    "NARDAS NAGAR": "Nardas",
    "RAM NAGAR": "^Ram Nagar$",
    "KRANTI NAGAR": "Kranti",
    "UTKARSH NAGAR": "Utkarsh",
    "JAIDEV SINGH NAGAR": "Jaidev|Jaideo",
    "KAJU TEKDI": "Kaju",
    "ASHOK TEKDI": "Ashok Tekdi",
    "PATHAN COLONY": "Pathan",
    "JOKIM COMPOUND": "Jokim|Joakim",
    "HAJARE": "Hajare",
    "AMBYACHI BHARNI": "Bharni",
    "SHELAR COMPOUND": "Shelar",
}
BBOX = (19.120, 72.905, 19.175, 72.965)  # generous Bhandup West box: S, W, N, E


def overpass(regex_by_name):
    """One combined Overpass request for every name pattern, split back per key locally (the public server is slow)."""
    cache_path = os.path.join(HERE, "osm-cache.json")
    if os.path.exists(cache_path):
        return json.load(open(cache_path, encoding="utf-8"))
    import re
    union = "|".join("(%s)" % rx for rx in regex_by_name.values())
    q = '[out:json][timeout:120];nwr["name"~"%s",i](%s,%s,%s,%s);out center tags 3000;' % (union, BBOX[0], BBOX[1], BBOX[2], BBOX[3])
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(),
                                 headers={"User-Agent": "postal-admin-research/1.0 (%s)" % os.environ.get("OSM_CONTACT", "set OSM_CONTACT to your contact"), "Accept": "application/json"})
    elements = []
    for attempt in range(4):
        try:
            elements = json.load(urllib.request.urlopen(req, timeout=180))["elements"]
            break
        except Exception as e:  # noqa
            print("retry", e, file=sys.stderr)
            time.sleep(8 * (attempt + 1))
    out = {key: [e for e in elements if re.search(rx, e.get("tags", {}).get("name", ""), re.I)] for key, rx in regex_by_name.items()}
    json.dump(out, open(cache_path, "w", encoding="utf-8"))
    return out


PREF = ["neighbourhood", "suburb", "quarter", "residential", "tertiary", "secondary", "living_street", "bus_stop", "police", "hospital"]


def choose(elements):
    def score(e):
        t = e["tags"]
        kind = t.get("place") or t.get("highway") or t.get("amenity") or t.get("landuse") or ""
        return PREF.index(kind) if kind in PREF else len(PREF)
    return sorted(elements, key=lambda e: (score(e), e["type"] != "node"))[0] if elements else None


def build_anchors():
    raw = overpass(ANCHOR_QUERIES)
    anchors = {}
    for key in ANCHOR_QUERIES:  # only the queries still listed (the cache may hold older, rejected ones)
        els = raw.get(key, [])
        pick = choose([e for e in els if (e.get("center") or e.get("lat") is not None)])
        if not pick:
            continue
        c = pick.get("center") or {"lat": pick["lat"], "lon": pick["lon"]}
        t = pick["tags"]
        anchors[key] = {"lat": round(c["lat"], 6), "lng": round(c["lon"], 6), "osmName": t.get("name"),
                        "osm": "%s/%s" % (pick["type"], pick["id"]), "kind": t.get("place") or t.get("highway") or t.get("amenity") or "",
                        "candidates": len(els)}
    json.dump(anchors, open(os.path.join(HERE, "locality-anchors.json"), "w", encoding="utf-8"), indent=1)
    return anchors


if __name__ == "__main__":
    write_csvs()
    a = build_anchors()
    print(len(a), "anchors found for", len(ANCHOR_QUERIES), "queries")
    for k, v in sorted(a.items()):
        print("  %-30s %.4f,%.4f  %s [%s] x%d" % (k, v["lat"], v["lng"], v["osmName"], v["kind"], v["candidates"]))
    print("no anchor:", ", ".join(sorted(set(ANCHOR_QUERIES) - set(a))))
