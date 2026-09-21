# Route optimization: DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS

There is exactly one route optimizer. It is not a setting: no API parameter, no environment variable and no app
screen can pick another algorithm (a client that sends `algorithm=...` is ignored). The stored algorithm name is
`DBSCAN_NN_2OPT_ALNS`; a route stored by an older pipeline is re-planned on the next read.

```
active deliveries ── road travel-time matrix (OSRM, cached, tiled if very large)
   -> DBSCAN over road times            clusters (noise stops become single-stop clusters)
   -> cluster order + Nearest Neighbor  initial route
   -> 2-opt (inside clusters, and over the cluster order)
   -> ALNS                              best route found
   -> OSRM road geometry  ->  the postman's app and the admin panel
```

Every stage - and the comparison "input order vs NN vs +2-opt vs +ALNS" - uses the SAME cost function
(`routeAlgorithms.ts`): `travel + loadWeight * load penalty + priorityWeight * priority penalty`, with arrival times
that include service (dwell) time. Road travel times are used whenever the routing engine answers; if it does not,
the whole route is planned from flagged straight-line estimates and says so.

### What "load" and "priority" are made of

- **Load is a real weight in kilograms** (`Delivery.weightKg`, imported from a `Weight` column or given when a delivery is
  created; positive, at most 1000). A **parcel count is never treated as a weight.** `metrics.loadBasis` says what the
  route used: `WEIGHT_KG` (every stop has a weight), `PARTIAL_WEIGHT_KG` (the stops without one get the median known weight),
  or `NONE` - no stop has a weight, so the load term is **switched off** (`loadWeight` is reported as 0) instead of being fed
  a stand-in. The Bhandup West data has no weights, so its routes are `NONE`.
- **Priority is in the cost that is optimised**: `priorityFactor` (LOW/NORMAL 0, HIGH 1, URGENT 3) x arrival time x
  `priorityWeight`, in the cost function, in the Nearest Neighbor selection key and in the ALNS insertion delta.
  `tests/routeLoadAndPriority.test.ts` shows an URGENT stop 315 s away going before a NORMAL stop 110 s away, the priority
  penalty being non-zero and part of `totalCost`.
- **A pincode-level location is not routed.** A delivery whose only location is the centre of its pincode would put every
  such stop on one spot; it is left out of the route and reported as `IMPRECISE_LOCATION`. Area-level points are routed.

## ALNS (`alns.ts`)

Adaptive Large Neighborhood Search (Ropke & Pisinger). Each iteration removes `q` stops (10%-40% of the route, at
most 25) with a destroy operator, puts them back with a repair operator, and decides whether to move to the new route.

| | operators |
|---|---|
| destroy | **random**; **worst** (stops whose removal saves the most); **related** (Shaw: close in road time, arrival time and priority); **cluster** (a whole DBSCAN cluster, or part of it) |
| repair | **greedy** (cheapest insertion); **regret-2**; **regret-3** (insert first the stop that loses most if it does not get its best place) |

* **Adaptive selection.** Every operator has a weight (start 1). Destroy and repair operators are picked by
  roulette wheel. A new global best scores 33, a route better than the current one 9, an accepted worse route 3.
  Every 50 iterations `w = 0.5 * w + 0.5 * score / uses` (never below 0.1), so operators that keep finding
  improvements are picked more often.
* **Acceptance: simulated annealing.** A worse route is accepted with probability `exp(-delta / T)`. `T` starts so a
  route 5% worse than the start is accepted half the time, and cools geometrically to 0.1% of that as the
  iteration / time budget is used up.
* **Best solution.** The best route seen is tracked separately and returned - never the last iteration - so the
  result can never be dearer than the 2-opt route it started from (and a guard re-checks it).
* **2-opt inside ALNS.** A candidate that beats the best route gets a short 2-opt pass, and the final route gets one
  more; a result is used only if strictly cheaper.
* **Stopping.** `ROUTE_ALNS_MAX_ITERATIONS` (2500), `ROUTE_ALNS_MAX_MS` (1500) and
  `ROUTE_ALNS_NO_IMPROVEMENT_LIMIT` (600), whichever comes first. Fewer than 3 stops: not run.
* **Speed.** The cost change of inserting a stop at ANY position has an exact closed form from prefix/suffix sums
  (travel, load and priority are all order dependent, but linear in those sums), so repair is O(k * n) per round.
  A test checks the closed form against the full cost function on random partial routes.
* **Deterministic.** A seeded generator: the same input gives the same route (given the same limits).

### Clusters: kept, and why (measured)

Every DBSCAN cluster stays one unbroken run (`ROUTE_ALNS_PRESERVE_CLUSTERS=true`, the default). ALNS can reorder stops inside a
cluster and move a whole cluster between two others, but a stop is only re-inserted inside its own cluster's run.

Whether that costs route quality was measured (`npm run route:clusters`, `data/bhandup/cluster-preservation-study.txt`; 20
deterministic synthetic rounds per row on a street-grid road model with a river - **not real roads**):

| Condition | Stops | Drive time, clusters kept | Drive time, clusters free | Difference | Run time kept / free |
|---|---|---|---|---|---|
| PLAIN (all NORMAL, no weights = the real Bhandup data) | 25 / 50 / 100 | 90.0 / 123.0 / 184.7 min | 89.7 / 123.2 / 184.6 min | -0.3 % / +0.2 % / -0.0 % | 30 / 122 / 348 ms vs 51 / 331 / 1491 ms |
| MIXED (random priorities and weights) | 25 / 50 / 100 | 108.0 / 168.1 / 269.0 min | 119.2 / 183.9 / 309.9 min | +10.4 % / +9.4 % / +15.2 % | 28 / 126 / 377 ms vs 57 / 380 / 1945 ms |

Reading it: with plain deliveries the two settings drive **the same time** (a few tenths of a percent either way) and keeping
clusters is 1.7-4x faster. With priorities and weights live, letting ALNS break clusters gives a *lower cost* but a **9-15 %
longer drive** - it spends driving time on the priority / load terms. Route quality, as the postman experiences it, is
therefore not hurt by keeping clusters and is better when priorities are used. **Decision: keep it on.**
`ROUTE_ALNS_PRESERVE_CLUSTERS=false` remains available for a post office that would rather minimise the weighted cost.

### Time windows: not implemented, on purpose

A delivery time window makes lateness a **non-linear** function of the arrival time (early = wait, late = penalty). The ALNS
speed comes from an exact closed form for the cost change of inserting a stop anywhere, which needs the cost to be linear in
prefix / suffix sums of travel, load and priority. A window term breaks that: every insertion would need a re-evaluation of
the rest of the route, and the search would slow by roughly the route length. And the data does not exist: no delivery
carries a window, and the import has no such column. Adding a fake one would be worse than none, so there is none.

### Performance and the background-job question

Measured (`npm run route:bench -- 25 50 100 200 --ms=1500`, deterministic synthetic rounds, one thread): the full pipeline takes
about 50 ms for 25 stops, 200 ms for 50, 800 ms for 100 and 850 ms for 200 (ALNS is capped at 1.5 s and 2-opt at 1.5 s, so the
worst case is about 3 s). A beat is a few dozen stops, so a route is planned **synchronously in the request**; moving planning
to a worker thread or queue would add machinery for a saving nobody would notice today. Revisit if rounds of several hundred
stops become normal - the event loop is blocked for the whole planning time.

## Re-planning

* New delivery, admin "Recalculate", the postman's "Recalculate", failed-attempt events: the full pipeline.
* A completed / removed delivery: the remaining order is kept (nothing is re-ordered); legs, ETAs, road geometry
  and metrics are refreshed.

## Diagnostics (admin only)

`solution.metrics` on `GET /postmen/:id/route` (and the collapsed "Technical details" panel of the postman's profile page):
input / NN / 2-opt / ALNS costs, ALNS iterations, improvements, accepted-worse, per-operator usage and weights,
stop reason, run time, clusters, matrix mode and the number of routing-engine requests. Not sent to the postman's
screens, which show only the optimized route.

## Measuring

`npm run route:alns` plans rounds of 1, 2, 5, 10, 25, 50 and 100 deliveries with the real routing engine and checks
the invariants; `npm run route:analyze -- <postman email>` shows one postman's stages (and the exact optimum when there are
9 stops or fewer).

`npm run route:bench` (no network, no database) measures every stage on the same deterministic rounds and the same cost
function - input order, NN, NN + 2-opt, DBSCAN + NN, DBSCAN + NN + 2-opt, and the full pipeline - and prints distance,
travel time, cost and runtime for each. `tests/routeBenchmark.test.ts` runs the same code for 10 / 25 / 50 / 100 stops and
asserts only the invariants (valid routes, ALNS never dearer than 2-opt, the production entry point returning the measured
route), never a target improvement. Add `--free-clusters` to see what the search finds when it may move stops between
DBSCAN clusters.
