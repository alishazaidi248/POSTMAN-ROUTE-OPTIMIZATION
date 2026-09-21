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

### Clusters

The DBSCAN structure is a hard rule of the pipeline: every cluster stays one unbroken run
(`ROUTE_ALNS_PRESERVE_CLUSTERS=true`, the default). ALNS can reorder stops inside a cluster and can move a whole
cluster to a better place between two other clusters, but a stop is only re-inserted inside its own cluster's run
(or between clusters when its whole cluster was removed). Setting it to `false` lets ALNS move a stop into another
cluster when that lowers the cost.

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

### Known trade-off: contiguous clusters vs. the weighted cost

Keeping each DBSCAN cluster as one unbroken run is a hard rule (`ROUTE_ALNS_PRESERVE_CLUSTERS=true`). It gives a round
that goes neighbourhood by neighbourhood, but it also shrinks the space ALNS may search. On the synthetic benchmark rounds
(20 % URGENT + 20 % HIGH stops, so the priority term is large), plain NN + 2-opt WITHOUT clustering can have a lower
weighted cost than the production route at some sizes. That plain route is not a candidate - the pipeline is fixed - but if
lowest weighted cost matters more than neighbourhood grouping, set `ROUTE_ALNS_PRESERVE_CLUSTERS=false`; ALNS then
went below plain NN + 2-opt on every benchmark round. Which of the two a post office wants is a business decision.

