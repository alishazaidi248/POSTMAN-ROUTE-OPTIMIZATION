import { OptimizationService } from "./OptimizationService";
import { MockOptimizationService } from "./MockOptimizationService";

let instance: OptimizationService | null = null;

export function getOptimizationService(): OptimizationService {
  if (!instance) instance = new MockOptimizationService();
  return instance;
}

export * from "./OptimizationService";
