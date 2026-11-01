import removeAntialiasing from "./edgeDetection";

function createImageData(width, height, colour) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = colour[0];
    data[index + 1] = colour[1];
    data[index + 2] = colour[2];
    data[index + 3] = colour[3];
  }
  return { data, width, height };
}

describe("removeAntialiasing", () => {
  test("snaps blended pixels between contrasting edges to a nearby colour", () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);
    for (let y = 0; y < 3; y++) {
      const whitePixel = (y * 3 + 2) * 4;
      imageData.data[whitePixel] = 255;
      imageData.data[whitePixel + 1] = 255;
      imageData.data[whitePixel + 2] = 255;

      const blendedPixel = (y * 3 + 1) * 4;
      imageData.data[blendedPixel] = 127;
      imageData.data[blendedPixel + 1] = 127;
      imageData.data[blendedPixel + 2] = 127;
    }

    removeAntialiasing(imageData);

    const centerPixel = (1 * 3 + 1) * 4;
    expect([0, 255]).toContain(imageData.data[centerPixel]);
    expect(imageData.data[centerPixel + 1]).toBe(imageData.data[centerPixel]);
    expect(imageData.data[centerPixel + 2]).toBe(imageData.data[centerPixel]);
  });

  test("leaves uniform and partially transparent pixels unchanged", () => {
    const imageData = createImageData(3, 3, [80, 90, 100, 255]);
    const centerPixel = (1 * 3 + 1) * 4;
    imageData.data[centerPixel] = 127;
    imageData.data[centerPixel + 1] = 127;
    imageData.data[centerPixel + 2] = 127;
    imageData.data[centerPixel + 3] = 128;
    const originalData = new Uint8ClampedArray(imageData.data);

    removeAntialiasing(imageData);

    expect(imageData.data).toEqual(originalData);
  });
});
