const highsModuleUrl = new URL("../../../../node_modules/highs/build/highs.mjs", import.meta.url);
const highsWasmUrl = new URL("../../../../node_modules/highs/build/highs.wasm", import.meta.url);

let highsPromise;

async function getHighs() {
  if (!highsPromise) {
    highsPromise = import(/* webpackIgnore: true */ highsModuleUrl.href).then(({ default: createHighs }) =>
      createHighs({ locateFile: (file) => (file.endsWith(".wasm") ? highsWasmUrl.href : file) })
    );
  }
  return highsPromise;
}

function feasibleBounds({ air, relations, anchors, depthBounds, width, depth, maxHeight }) {
  const size = width * depth;
  const lo = Int32Array.from(depthBounds);
  const hi = new Int32Array(size).fill(maxHeight);
  for (let index = 0; index < size; index += 1) {
    if (anchors[index] >= 0) lo[index] = hi[index] = anchors[index];
  }

  for (let z = depth - 2; z >= 0; z -= 1) {
    for (let x = 0; x < width; x += 1) {
      const index = x * depth + z;
      const next = index + 1;
      if (air[index] || air[next]) continue;
      const relation = relations[next];
      if (relation === 2) hi[index] = Math.min(hi[index], hi[next] - 1);
      else if (relation === 1) hi[index] = Math.min(hi[index], hi[next]);
      if (relation === 3) lo[index] = Math.max(lo[index], lo[next] + 1);
      else if (relation === 1) lo[index] = Math.max(lo[index], lo[next]);
    }
  }

  for (let index = 0; index < size; index += 1) {
    if (!air[index] && lo[index] > hi[index]) {
      throw new Error("Inconsistent optimized staircase height constraints.");
    }
  }
  return { lo, hi };
}

function subgrid(values, sourceDepth, x0, x1, z0, z1, ArrayType) {
  const depth = z1 - z0;
  const result = new ArrayType((x1 - x0) * depth);
  for (let x = x0; x < x1; x += 1) {
    for (let z = z0; z < z1; z += 1) {
      result[(x - x0) * depth + z - z0] = values[x * sourceDepth + z];
    }
  }
  return result;
}

function buildPlateaus(air, relations, lo, hi, width, depth) {
  const size = width * depth;
  const plateauIds = new Int32Array(size);
  const starts = [];
  let count = 0;
  for (let index = 0; index < size; index += 1) {
    if (!air[index] && relations[index] !== 1) {
      starts.push(index);
      count += 1;
    }
    plateauIds[index] = air[index] ? -1 : count - 1;
  }

  const lengths = new Float64Array(count);
  const lows = new Float64Array(count);
  const highs = new Float64Array(count);
  const constraints = [];
  const increasing = [];
  for (let index = 0; index < size; index += 1) {
    if (!air[index]) lengths[plateauIds[index]] += 1;
  }
  for (let plateau = 0; plateau < count; plateau += 1) {
    const index = starts[plateau];
    lows[plateau] = lo[index];
    highs[plateau] = hi[index];
    if (relations[index] === 2 || relations[index] === 3) {
      constraints.push(plateau);
      increasing.push(relations[index] === 2);
    }
  }
  return {
    ids: plateauIds,
    count,
    starts,
    lengths,
    lows,
    highs,
    constraints,
    previousPlateaus: constraints.map((plateau) => plateau - 1),
    increasing,
  };
}

function buildEdges(plateauIds, width, depth, plateauCount) {
  const keys = [];
  for (let x = 0; x < width - 1; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      const first = plateauIds[x * depth + z];
      const second = plateauIds[(x + 1) * depth + z];
      if (first >= 0 && second >= 0) keys.push(first * plateauCount + second);
    }
  }
  keys.sort((a, b) => a - b);
  const first = [];
  const second = [];
  const weights = [];
  for (let index = 0; index < keys.length;) {
    let end = index + 1;
    while (end < keys.length && keys[end] === keys[index]) end += 1;
    first.push(Math.floor(keys[index] / plateauCount));
    second.push(keys[index] % plateauCount);
    weights.push(end - index);
    index = end;
  }
  return { first, second, weights };
}

function formatCoefficient(value) {
  return `${value < 0 ? "-" : "+"} ${Math.abs(value)}`;
}

async function solveTile(air, relations, anchors, lo, hi, width, depth, params, {
  reweight,
  eta = 0.5,
  budget = false,
} = {}) {
  const plateaus = buildPlateaus(air, relations, lo, hi, width, depth);
  const result = new Int32Array(width * depth);
  const { count } = plateaus;
  if (count === 0) return result;

  const { first, second, weights: plainWeights } = buildEdges(plateaus.ids, width, depth, count);
  const edgeCount = first.length;
  const weights = reweight
    ? plainWeights.map((weight, edge) => {
      const firstHeight = reweight[plateaus.starts[first[edge]]];
      const secondHeight = reweight[plateaus.starts[second[edge]]];
      return weight / (Math.abs(firstHeight - secondHeight) + eta);
    })
    : plainWeights;

  const cost = new Float64Array(count + edgeCount);
  for (let plateau = 0; plateau < count; plateau += 1) {
    cost[plateau] += params.gravity * plateaus.lengths[plateau];
  }
  for (let edge = 0; edge < edgeCount; edge += 1) cost[count + edge] = weights[edge];
  for (let constraint = 0; constraint < plateaus.constraints.length; constraint += 1) {
    const sign = plateaus.increasing[constraint] ? 1 : -1;
    cost[plateaus.constraints[constraint]] += params.jump * sign;
    cost[plateaus.previousPlateaus[constraint]] -= params.jump * sign;
  }

  const rows = ["Minimize"];
  let objective = " obj:";
  for (let variable = 0; variable < cost.length; variable += 1) {
    objective += ` ${formatCoefficient(cost[variable])} ${variable < count ? `h${variable}` : `e${variable - count}`}`;
    if ((variable + 1) % 12 === 0) {
      rows.push(objective);
      objective = " ";
    }
  }
  rows.push(objective, "Subject To");
  let row = 0;
  for (let edge = 0; edge < edgeCount; edge += 1) {
    rows.push(` r${row++}: + 1 h${first[edge]} - 1 h${second[edge]} - 1 e${edge} <= 0`);
    rows.push(` r${row++}: + 1 h${second[edge]} - 1 h${first[edge]} - 1 e${edge} <= 0`);
  }
  for (let constraint = 0; constraint < plateaus.constraints.length; constraint += 1) {
    const lower = plateaus.increasing[constraint]
      ? plateaus.previousPlateaus[constraint]
      : plateaus.constraints[constraint];
    const upper = plateaus.increasing[constraint]
      ? plateaus.constraints[constraint]
      : plateaus.previousPlateaus[constraint];
    rows.push(` r${row++}: + 1 h${lower} - 1 h${upper} <= -1`);
  }

  if (budget && reweight && edgeCount) {
    let bound = 0;
    let constraint = ` r${row++}:`;
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const firstHeight = reweight[plateaus.starts[first[edge]]];
      const secondHeight = reweight[plateaus.starts[second[edge]]];
      bound += plainWeights[edge] * Math.abs(firstHeight - secondHeight);
      constraint += ` + ${plainWeights[edge]} e${edge}`;
      if ((edge + 1) % 12 === 0) {
        rows.push(constraint);
        constraint = " ";
      }
    }
    rows.push(`${constraint} <= ${bound + 1e-6}`);
  }
  if (row === 0) rows.push(" r0: + 1 h0 >= -1000000000");
  rows.push("Bounds");
  for (let plateau = 0; plateau < count; plateau += 1) {
    rows.push(` ${plateaus.lows[plateau]} <= h${plateau} <= ${plateaus.highs[plateau]}`);
  }
  rows.push("End");

  const highs = await getHighs();
  let solution;
  let lastError;
  for (const options of [{ solver: "ipm" }, {}]) {
    try {
      solution = highs.solve(rows.join("\n"), options);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!solution) throw new Error(`HiGHS failed to solve the optimized staircase: ${lastError?.message || "unknown error"}`);
  if (solution.Status !== "Optimal" || !solution.Columns) {
    throw new Error(`HiGHS returned ${solution.Status} for the optimized staircase.`);
  }

  const heights = new Int32Array(count);
  for (let plateau = 0; plateau < count; plateau += 1) {
    const variable = solution.Columns[`h${plateau}`];
    if (!variable) throw new Error(`HiGHS omitted staircase height h${plateau}.`);
    heights[plateau] = Math.round(variable.Primal);
  }
  for (let index = 0; index < result.length; index += 1) {
    if (plateaus.ids[index] >= 0) result[index] = heights[plateaus.ids[index]];
  }
  return result;
}

async function solveExact(data, params, { irls = 0, onProgress = () => {} } = {}) {
  const { width, depth } = data;
  const { lo, hi } = feasibleBounds(data);
  const heights = Int32Array.from(data.heights);
  const tileWidth = 128;
  const tileDepth = 128;
  const xCuts = [];
  for (let x = 0; x < width; x += tileWidth) xCuts.push(x);
  xCuts.push(width);
  const zCuts = [...new Set([0, depth, ...Array.from(
    { length: Math.floor((depth - 1) / tileDepth) },
    (_, index) => tileDepth + 1 + index * tileDepth
  )])].sort((a, b) => a - b);
  const tileCount = (xCuts.length - 1) * (zCuts.length - 1);
  let completed = 0;

  for (let zi = 0; zi < zCuts.length - 1; zi += 1) {
    const z0 = zCuts[zi];
    const z1 = zCuts[zi + 1];
    for (let xi = 0; xi < xCuts.length - 1; xi += 1) {
      const x0 = xCuts[xi];
      const x1 = xCuts[xi + 1];
      const xStart = Math.max(x0 - 1, 0);
      const zStart = Math.max(z0 - 1, 0);
      const tileX = x1 - xStart;
      const tileZ = z1 - zStart;
      const air = subgrid(data.air, depth, xStart, x1, zStart, z1, Uint8Array);
      const relations = subgrid(data.relations, depth, xStart, x1, zStart, z1, Uint8Array);
      const anchors = subgrid(data.anchors, depth, xStart, x1, zStart, z1, Int32Array);
      const tileLo = subgrid(lo, depth, xStart, x1, zStart, z1, Int32Array);
      const tileHi = subgrid(hi, depth, xStart, x1, zStart, z1, Int32Array);
      const fixed = new Uint8Array(tileX * tileZ);
      if (z0 > 0) {
        for (let x = 0; x < tileX; x += 1) {
          fixed[x * tileZ] = 1;
          relations[x * tileZ] = 3;
        }
      }
      if (x0 > 0) {
        for (let z = 0; z < tileZ; z += 1) fixed[z] = 1;
      }
      const current = subgrid(heights, depth, xStart, x1, zStart, z1, Int32Array);
      for (let index = 0; index < fixed.length; index += 1) {
        if (air[index]) fixed[index] = 0;
        if (fixed[index]) anchors[index] = tileLo[index] = tileHi[index] = current[index];
      }

      let tileHeights = await solveTile(air, relations, anchors, tileLo, tileHi, tileX, tileZ, params);
      for (let iteration = 0; iteration < irls; iteration += 1) {
        tileHeights = await solveTile(air, relations, anchors, tileLo, tileHi, tileX, tileZ, params, {
          reweight: tileHeights,
          eta: 0.5,
          budget: false,
        });
      }
      for (let x = 0; x < tileX; x += 1) {
        for (let z = 0; z < tileZ; z += 1) {
          const index = x * tileZ + z;
          if (!fixed[index]) heights[(xStart + x) * depth + zStart + z] = tileHeights[index];
        }
      }
      completed += 1;
      onProgress(completed / tileCount);
    }
  }
  return heights;
}

export default solveExact;
