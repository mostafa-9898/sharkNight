import * as fs from 'fs';
import * as path from 'path';
import { calculateFisherRsi, fisherCrossEvents } from '../../src/indicators/fisher-rsi';

interface ExpectedCandle {
  time: number;
  fisherScaled: number | null;
  signalScaled: number | null;
  anyCrossUp: boolean;
  anyCrossDown: boolean;
  zoneCrossUp: boolean;
  zoneCrossDown: boolean;
}

interface FixtureContent {
  source: string;
  crossVerifiedWith: string;
  candlesRange: {
    count: number;
    symbol: string;
    timeframe: string;
    startTime: number;
    endTime: number;
    startDate: string;
    endDate: string;
  };
  parameters: {
    rsiLength: number;
    rsiSmoothing: number;
    fisherLength: number;
    oversold: number;
    overbought: number;
  };
  candles: Array<{ time: number; close: number }>;
  expected: ExpectedCandle[];
}

describe('Fisher Pine Run Parity Test (RG0-f)', () => {
  const fixturePath = path.resolve('tests/fixtures/fisher_pine_run.json');

  it('verifies that fisher_pine_run.json exists and has valid metadata', () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const fixture: FixtureContent = JSON.parse(raw);

    expect(fixture.source).toBe('pinets');
    expect(fixture.crossVerifiedWith).toBe('independent-port');
    expect(fixture.candlesRange.count).toBe(500);
    expect(fixture.candles.length).toBe(500);
    expect(fixture.expected.length).toBe(500);
  });

  it('matches calculateFisherRsi scaled and signalScaled with tolerance <= 0.01 after 100 warm-up bars', () => {
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const fixture: FixtureContent = JSON.parse(raw);

    const closes = fixture.candles.map((c) => c.close);
    const result = calculateFisherRsi(closes, {
      rsiPeriod: fixture.parameters.rsiLength,
      rsiSmoothing: fixture.parameters.rsiSmoothing,
      window: fixture.parameters.fisherLength,
    });

    let maxFisherError = 0;
    let maxSignalError = 0;

    for (let i = 100; i < fixture.expected.length; i++) {
      const exp = fixture.expected[i];
      if (exp.fisherScaled !== null && Number.isFinite(exp.fisherScaled)) {
        const err = Math.abs(result.scaled[i] - exp.fisherScaled);
        if (err > maxFisherError) maxFisherError = err;
        expect(result.scaled[i]).toBeCloseTo(exp.fisherScaled, 2);
      }

      if (exp.signalScaled !== null && Number.isFinite(exp.signalScaled)) {
        const err = Math.abs(result.signalScaled[i] - exp.signalScaled);
        if (err > maxSignalError) maxSignalError = err;
        expect(result.signalScaled[i]).toBeCloseTo(exp.signalScaled, 2);
      }
    }

    expect(maxFisherError).toBeLessThanOrEqual(0.01);
    expect(maxSignalError).toBeLessThanOrEqual(0.01);
  });

  it('achieves 100% exact parity on all Fisher crossover and crossunder events', () => {
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const fixture: FixtureContent = JSON.parse(raw);

    const closes = fixture.candles.map((c) => c.close);
    const result = calculateFisherRsi(closes, {
      rsiPeriod: fixture.parameters.rsiLength,
      rsiSmoothing: fixture.parameters.rsiSmoothing,
      window: fixture.parameters.fisherLength,
    });

    const events = fisherCrossEvents(result, {
      oversoldLevel: fixture.parameters.oversold,
      overboughtLevel: fixture.parameters.overbought,
    });

    let anyCrossUpMatches = 0;
    let anyCrossDownMatches = 0;
    let zoneCrossUpMatches = 0;
    let zoneCrossDownMatches = 0;

    for (let i = 0; i < fixture.expected.length; i++) {
      const exp = fixture.expected[i];
      const ev = events[i];

      expect(ev.anyCrossUp).toBe(exp.anyCrossUp);
      expect(ev.anyCrossDown).toBe(exp.anyCrossDown);
      expect(ev.zoneCrossUp).toBe(exp.zoneCrossUp);
      expect(ev.zoneCrossDown).toBe(exp.zoneCrossDown);

      if (ev.anyCrossUp === exp.anyCrossUp) anyCrossUpMatches++;
      if (ev.anyCrossDown === exp.anyCrossDown) anyCrossDownMatches++;
      if (ev.zoneCrossUp === exp.zoneCrossUp) zoneCrossUpMatches++;
      if (ev.zoneCrossDown === exp.zoneCrossDown) zoneCrossDownMatches++;
    }

    expect(anyCrossUpMatches).toBe(fixture.expected.length);
    expect(anyCrossDownMatches).toBe(fixture.expected.length);
    expect(zoneCrossUpMatches).toBe(fixture.expected.length);
    expect(zoneCrossDownMatches).toBe(fixture.expected.length);
  });
});
