import { Outcome } from './learning-loop.js';

export type IpsUpdate = {
  reward: number;
  weight: number;
};

export function computeIps(outcome: Outcome, overallProb: number): IpsUpdate {
  const reward = outcome === 'WON' ? 1 : 0;
  const p = Math.max(1e-6, overallProb);
  const w = 1 / p;
  const capped = Math.min(50, w);
  return { reward, weight: capped };
}

export function ipsMean(rewardSum: number, weightSum: number): number {
  if (weightSum <= 0) return 0;
  return rewardSum / weightSum;
}
