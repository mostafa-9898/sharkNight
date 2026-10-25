/**
 * Independent line-by-line port of docs/reference/fisher-rsi-pinescript.pine.md
 * Written without importing anything from src/
 */

export function nz(val, defVal = 0) {
  return typeof val === 'number' && Number.isFinite(val) ? val : defVal;
}

export function rma(values, length) {
  const result = new Array(values.length).fill(NaN);
  let sum = 0;
  let count = 0;
  let initialized = false;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      continue;
    }
    if (!initialized) {
      sum += v;
      count++;
      if (count === length) {
        result[i] = sum / length;
        initialized = true;
      }
    } else {
      const prev = result[i - 1];
      result[i] = (v + (length - 1) * prev) / length;
    }
  }
  return result;
}

export function rsi(closes, length = 14) {
  const n = closes.length;
  const u = new Array(n).fill(NaN);
  const d = new Array(n).fill(NaN);

  for (let i = 1; i < n; i++) {
    const change = closes[i] - closes[i - 1];
    u[i] = change > 0 ? change : 0;
    d[i] = change < 0 ? -change : 0;
  }

  const uRma = rma(u, length);
  const dRma = rma(d, length);
  const result = new Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    const up = uRma[i];
    const dn = dRma[i];
    if (!Number.isFinite(up) || !Number.isFinite(dn)) {
      continue;
    }
    if (dn === 0) {
      result[i] = up === 0 ? 50 : 100;
    } else {
      const rs = up / dn;
      result[i] = 100 - 100 / (1 + rs);
    }
  }
  return result;
}

export function sma(values, length = 1) {
  if (length <= 1) return [...values];
  const n = values.length;
  const result = new Array(n).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > length) {
      sum -= values[i - length];
      count--;
    }
    if (count === length) {
      result[i] = sum / length;
    }
  }
  return result;
}

export function highest(values, length, currentIndex) {
  let h = -Infinity;
  let found = false;
  for (let k = 0; k < length; k++) {
    const idx = currentIndex - k;
    if (idx < 0) break;
    const v = values[idx];
    if (Number.isFinite(v)) {
      if (v > h) h = v;
      found = true;
    }
  }
  return found ? h : NaN;
}

export function lowest(values, length, currentIndex) {
  let l = Infinity;
  let found = false;
  for (let k = 0; k < length; k++) {
    const idx = currentIndex - k;
    if (idx < 0) break;
    const v = values[idx];
    if (Number.isFinite(v)) {
      if (v < l) l = v;
      found = true;
    }
  }
  return found ? l : NaN;
}

export function runFisherIndependent(candles, options = {}) {
  const rsiLength = options.rsiLength ?? 14;
  const rsiSmoothing = options.rsiSmoothing ?? 1;
  const oversoldLevel = options.oversoldLevel ?? 30;
  const overboughtLevel = options.overboughtLevel ?? 70;
  const fisherLength = options.fisherLength ?? 10;
  const showFisherArrows = options.showFisherArrows ?? true;
  const enableFisherTransform = options.enableFisherTransform ?? true;

  const closes = candles.map((c) => (typeof c === 'number' ? c : c.close));
  const n = closes.length;

  const rawRsi = rsi(closes, rsiLength);
  const rsiScore = rsiSmoothing > 1 ? sma(rawRsi, rsiSmoothing) : rawRsi;

  const fisherValue1Arr = new Array(n).fill(0);
  const fisherTransformArr = new Array(n).fill(0);
  const fisherSignalArr = new Array(n).fill(NaN);
  const fisherValueScaledArr = new Array(n).fill(NaN);
  const signalScaledArr = new Array(n).fill(NaN);

  const anyCrossUpArr = new Array(n).fill(false);
  const anyCrossDownArr = new Array(n).fill(false);
  const zoneCrossUpArr = new Array(n).fill(false);
  const zoneCrossDownArr = new Array(n).fill(false);

  let fisher_value1 = 0.0;
  let fisher_transform = 0.0;

  for (let i = 0; i < n; i++) {
    const score = rsiScore[i];
    const prevFisherValue1 = i > 0 ? fisherValue1Arr[i - 1] : 0.0;
    const prevFisherTransform = i > 0 ? fisherTransformArr[i - 1] : 0.0;

    const fHighest = highest(rsiScore, fisherLength, i);
    const fLowest = lowest(rsiScore, fisherLength, i);
    const fRange = Number.isFinite(fHighest) && Number.isFinite(fLowest) ? fHighest - fLowest : NaN;

    const fisherPosition =
      Number.isFinite(score) && Number.isFinite(fRange) && fRange !== 0
        ? (score - fLowest) / fRange - 0.5
        : 0.0;

    fisher_value1 = 0.33 * 2 * fisherPosition + 0.67 * nz(prevFisherValue1, 0.0);
    fisher_value1 = Math.max(-0.999, Math.min(0.999, fisher_value1));

    fisher_transform =
      0.5 * Math.log((1 + fisher_value1) / (1 - fisher_value1)) + 0.5 * nz(prevFisherTransform, 0.0);

    const fisher_signal = i > 0 ? prevFisherTransform : NaN;
    const fisher_value_scaled = 50 + fisher_transform * 10;
    const signal_scaled = i > 0 ? 50 + fisher_signal * 10 : NaN;

    fisherValue1Arr[i] = fisher_value1;
    fisherTransformArr[i] = fisher_transform;
    fisherSignalArr[i] = fisher_signal;
    fisherValueScaledArr[i] = enableFisherTransform ? fisher_value_scaled : NaN;
    signalScaledArr[i] = enableFisherTransform ? signal_scaled : NaN;

    // Cross checks (crossover / crossunder in Pine)
    const prevTransform = i > 0 ? fisherTransformArr[i - 1] : NaN;
    const prevSignal = i > 1 ? fisherTransformArr[i - 2] : (i === 1 ? 0.0 : NaN);

    let crossUp = false;
    let crossDown = false;
    if (i >= 1 && Number.isFinite(fisher_transform) && Number.isFinite(fisher_signal) && Number.isFinite(prevTransform) && Number.isFinite(prevSignal)) {
      crossUp = prevTransform <= prevSignal && fisher_transform > fisher_signal;
      crossDown = prevTransform >= prevSignal && fisher_transform < fisher_signal;
    }

    const bullZone =
      (Number.isFinite(score) && score <= oversoldLevel) ||
      (Number.isFinite(fisher_value_scaled) && fisher_value_scaled <= oversoldLevel);

    const bearZone =
      (Number.isFinite(score) && score >= overboughtLevel) ||
      (Number.isFinite(fisher_value_scaled) && fisher_value_scaled >= overboughtLevel);

    anyCrossUpArr[i] = crossUp;
    anyCrossDownArr[i] = crossDown;
    zoneCrossUpArr[i] = showFisherArrows && crossUp && bullZone;
    zoneCrossDownArr[i] = showFisherArrows && crossDown && bearZone;
  }

  return {
    candles,
    rsiScore,
    fisherTransform: fisherTransformArr,
    fisherSignal: fisherSignalArr,
    fisherScaled: fisherValueScaledArr,
    signalScaled: signalScaledArr,
    anyCrossUp: anyCrossUpArr,
    anyCrossDown: anyCrossDownArr,
    zoneCrossUp: zoneCrossUpArr,
    zoneCrossDown: zoneCrossDownArr,
  };
}
