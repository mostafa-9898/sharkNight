import * as fs from 'fs';
import * as path from 'path';

interface FixtureRow {
  time?: number | string;
  close: number;
  fisherScaled?: number;
  signalScaled?: number;
}

interface GoldenFixture {
  description: string;
  source: string;
  rsiPeriod: number;
  window: number;
  rsiSmoothing: number;
  candleCount: number;
  candles: Array<{ time?: number | string; close: number }>;
  expected: Array<{ fisherScaled?: number; signalScaled?: number }>;
}

export function parsePineCsv(csvContent: string): {
  candles: Array<{ time?: number | string; close: number }>;
  expected: Array<{ fisherScaled?: number; signalScaled?: number }>;
  finiteCount: number;
} {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error(`CSV content too short: only ${lines.length} lines found.`);
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const timeIdx = headers.findIndex((h) => h === 'time' || h === 'timestamp' || h === 'date');
  const closeIdx = headers.findIndex((h) => h === 'close' || h === 'price');
  const fisherIdx = headers.findIndex(
    (h) => h === 'fisher' || h === 'fisherscaled' || h === 'fisher_scaled' || h.includes('fisher transform')
  );
  const signalIdx = headers.findIndex(
    (h) => h === 'signal' || h === 'signalscaled' || h === 'signal_scaled' || h.includes('signal')
  );

  if (closeIdx === -1) {
    throw new Error(
      `CSV header must contain a 'close' column. Found headers: ${headers.join(', ')}`
    );
  }

  const candles: Array<{ time?: number | string; close: number }> = [];
  const expected: Array<{ fisherScaled?: number; signalScaled?: number }> = [];
  let finiteFisherCount = 0;
  let finiteSignalCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (rawCols.length < headers.length) {
      continue;
    }

    const closeVal = parseFloat(rawCols[closeIdx]);
    if (Number.isNaN(closeVal)) {
      continue;
    }

    const timeVal = timeIdx !== -1 ? rawCols[timeIdx] : i;
    candles.push({ time: isNaN(Number(timeVal)) ? timeVal : Number(timeVal), close: closeVal });

    let fisherVal: number | undefined = undefined;
    if (fisherIdx !== -1 && rawCols[fisherIdx] !== '' && rawCols[fisherIdx] !== 'NaN' && rawCols[fisherIdx] !== 'na') {
      const parsed = parseFloat(rawCols[fisherIdx]);
      if (Number.isFinite(parsed)) {
        fisherVal = parsed;
        finiteFisherCount++;
      }
    }

    let signalVal: number | undefined = undefined;
    if (signalIdx !== -1 && rawCols[signalIdx] !== '' && rawCols[signalIdx] !== 'NaN' && rawCols[signalIdx] !== 'na') {
      const parsed = parseFloat(rawCols[signalIdx]);
      if (Number.isFinite(parsed)) {
        signalVal = parsed;
        finiteSignalCount++;
      }
    }

    expected.push({ fisherScaled: fisherVal, signalScaled: signalVal });
  }

  if (candles.length < 60) {
    throw new Error(
      `Schema validation failed: CSV contains only ${candles.length} valid candles (minimum 60 required).`
    );
  }

  const finiteCount = Math.max(finiteFisherCount, finiteSignalCount);
  if (finiteCount < 20) {
    throw new Error(
      `Schema validation failed: CSV contains only ${finiteCount} finite expected values for fisher/signal (minimum 20 required).`
    );
  }

  return { candles, expected, finiteCount };
}

export function convertCsvToFixture(
  csvFilePath: string,
  outputJsonPath: string = path.resolve(process.cwd(), 'tests', 'fixtures', 'fisher_golden.json')
): GoldenFixture {
  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`CSV file not found: ${csvFilePath}`);
  }

  const content = fs.readFileSync(csvFilePath, 'utf-8');
  const { candles, expected, finiteCount } = parsePineCsv(content);

  const fixture: GoldenFixture = {
    description: 'TradingView Pine Script Golden Benchmark for Fisher-RSI (rsiPeriod: 14, window: 10, rsiSmoothing: 1)',
    source: path.basename(csvFilePath),
    rsiPeriod: 14,
    window: 10,
    rsiSmoothing: 1,
    candleCount: candles.length,
    candles,
    expected,
  };

  const outDir = path.dirname(outputJsonPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputJsonPath, JSON.stringify(fixture, null, 2), 'utf-8');
  console.log(`Successfully generated fixture: ${outputJsonPath}`);
  console.log(`- Candles count: ${candles.length} (>= 60)`);
  console.log(`- Finite expected values: ${finiteCount} (>= 20)`);

  return fixture;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: npx tsx src/scripts/make-fisher-fixture.ts <path-to-pinescript-csv> [output-json-path]`);
    console.log(`\nExpected CSV columns:`);
    console.log(`  time, close, fisher, signal`);
    console.log(`Requirements:`);
    console.log(`  - Minimum 60 candles`);
    console.log(`  - Minimum 20 finite expected values`);
    console.log(`Default output path: tests/fixtures/fisher_golden.json`);
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const inputCsv = path.resolve(process.cwd(), args[0]);
  const outputJson = args[1]
    ? path.resolve(process.cwd(), args[1])
    : path.resolve(process.cwd(), 'tests', 'fixtures', 'fisher_golden.json');

  try {
    convertCsvToFixture(inputCsv, outputJson);
  } catch (err) {
    console.error(`Error generating fixture:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
