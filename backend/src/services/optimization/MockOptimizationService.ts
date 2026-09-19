import { prisma } from "../../config/prisma";
import {
  OptimizationProblem,
  OptimizationService,
  OptimizationSolution,
  OptimizationStop
} from "./OptimizationService";

/**
 * Deterministic development stand-in. It sequences deliveries in the order
 * given and walks the clock forward by a fixed per-stop duration — it is
 * NOT a routing algorithm and must never be mistaken for one. The real
 * research optimization engine (GA/ACO/ALNS/clustering) replaces this
 * implementation later behind the same OptimizationService interface.
 */
export class MockOptimizationService implements OptimizationService {
  private readonly minutesPerStop = 8;

  async planRoute(problem: OptimizationProblem): Promise<OptimizationSolution> {
    const deliveries = await prisma.delivery.findMany({
      where: { id: { in: problem.deliveryIds } },
      include: { address: true }
    });

    const start = new Date();
    const stops: OptimizationStop[] = deliveries.map((delivery, index) => {
      const eta = new Date(start.getTime() + index * this.minutesPerStop * 60_000);
      return {
        deliveryId: delivery.id,
        sequence: index + 1,
        latitude: delivery.address.latitude ?? 0,
        longitude: delivery.address.longitude ?? 0,
        estimatedArrival: eta.toISOString()
      };
    });

    return {
      postmanId: problem.postmanId,
      beatId: problem.beatId,
      stops,
      totalDistanceMeters: stops.length * 350,
      estimatedDurationMinutes: stops.length * this.minutesPerStop,
      algorithm: "MOCK_SEQUENTIAL",
      generatedAt: new Date().toISOString()
    };
  }

  async reoptimize(problem: OptimizationProblem, _triggerEvent: string): Promise<OptimizationSolution> {
    return this.planRoute(problem);
  }
}
