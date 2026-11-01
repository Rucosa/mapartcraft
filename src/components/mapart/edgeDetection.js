const NEIGHBOUR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const EDGE_THRESHOLD_SQUARED = 3 * 48 * 48;
const ANTIALIAS_TOLERANCE_SQUARED = 3 * 20 * 20;

export default function removeAntialiasing(imageData) {
  const { data, width, height } = imageData;
  const source = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pixelIndex = (y * width + x) * 4;
      if (source[pixelIndex + 3] !== 255) continue;

      const neighbours = NEIGHBOUR_OFFSETS.map(([offsetX, offsetY]) => {
        const index = ((y + offsetY) * width + x + offsetX) * 4;
        return {
          index,
          red: source[index],
          green: source[index + 1],
          blue: source[index + 2],
          alpha: source[index + 3],
        };
      }).filter((neighbour) => neighbour.alpha === 255);

      let firstColour = null;
      let secondColour = null;
      let largestDistanceSquared = 0;

      for (let firstIndex = 0; firstIndex < neighbours.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < neighbours.length; secondIndex++) {
          const first = neighbours[firstIndex];
          const second = neighbours[secondIndex];
          const redDifference = first.red - second.red;
          const greenDifference = first.green - second.green;
          const blueDifference = first.blue - second.blue;
          const distanceSquared = redDifference * redDifference + greenDifference * greenDifference + blueDifference * blueDifference;

          if (distanceSquared > largestDistanceSquared) {
            largestDistanceSquared = distanceSquared;
            firstColour = first;
            secondColour = second;
          }
        }
      }

      if (largestDistanceSquared < EDGE_THRESHOLD_SQUARED) continue;

      const redDifference = secondColour.red - firstColour.red;
      const greenDifference = secondColour.green - firstColour.green;
      const blueDifference = secondColour.blue - firstColour.blue;
      const projection =
        ((source[pixelIndex] - firstColour.red) * redDifference +
          (source[pixelIndex + 1] - firstColour.green) * greenDifference +
          (source[pixelIndex + 2] - firstColour.blue) * blueDifference) /
        largestDistanceSquared;

      if (projection <= 0.1 || projection >= 0.9) continue;

      const redResidual = source[pixelIndex] - (firstColour.red + projection * redDifference);
      const greenResidual = source[pixelIndex + 1] - (firstColour.green + projection * greenDifference);
      const blueResidual = source[pixelIndex + 2] - (firstColour.blue + projection * blueDifference);
      const residualSquared = redResidual * redResidual + greenResidual * greenResidual + blueResidual * blueResidual;
      if (residualSquared > ANTIALIAS_TOLERANCE_SQUARED) continue;

      const nearestColour = projection < 0.5 ? firstColour : secondColour;
      data[pixelIndex] = nearestColour.red;
      data[pixelIndex + 1] = nearestColour.green;
      data[pixelIndex + 2] = nearestColour.blue;
    }
  }

  return imageData;
}
