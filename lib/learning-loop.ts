export type Outcome = 'WON' | 'LOST';

export type WeightVector = {
  intentWeight: number;
  urgencyWeight: number;
  budgetWeight: number;
  fitWeight: number;
};

export type LeadFeatureVector = {
  intentDepth: number;
  urgencyVelocity: number;
  budgetSignals: number;
  fitPrecision: number;
};

export function updateWeights(current: WeightVector, features: LeadFeatureVector, outcome: Outcome): WeightVector {
  // Simple online update rule: reinforce weights for features present in wins, dampen for losses.
  // Keeps weights bounded to avoid instability.
  const lr = 0.02;
  const y = outcome === 'WON' ? 1 : -1;

  const next: WeightVector = {
    intentWeight: clamp(current.intentWeight + lr * y * norm(features.intentDepth), 0.5, 2.0),
    urgencyWeight: clamp(current.urgencyWeight + lr * y * norm(features.urgencyVelocity), 0.5, 2.0),
    budgetWeight: clamp(current.budgetWeight + lr * y * norm(features.budgetSignals), 0.5, 2.0),
    fitWeight: clamp(current.fitWeight + lr * y * norm(features.fitPrecision), 0.5, 2.0)
  };

  return next;
}

function norm(v: number): number {
  // input roughly in -10..50 range; scale to -1..1
  return clamp(v / 50, -1, 1);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
