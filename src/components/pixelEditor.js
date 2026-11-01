import React, { useCallback, useEffect, useRef, useState } from "react";

import ColourMethods from "./mapart/json/colourMethods.json";
import DitherMethods from "./mapart/json/ditherMethods.json";
import MapModes from "./mapart/json/mapModes.json";
import BlockImage from "./mapart/blockImage";
import IMG_GridOverlay from "../images/gridOverlay.png";
import IMG_Null from "../images/null.png";
import IMG_Textures from "../images/textures.png";
import "./mapart/blockSelection.css";

const MIN_ZOOM = 1;
const MAX_ZOOM = 40;
const ZOOM_STEP = 1.25;
const activeToolButtonStyle = {
  backgroundColor: "#3a3a3a",
  borderColor: "#222",
  color: "#fff",
};

const getPolygon = (area) => area.polygon || [
  { x: area.x, y: area.y },
  { x: area.x + area.width, y: area.y },
  { x: area.x + area.width, y: area.y + area.height },
  { x: area.x, y: area.y + area.height },
];

const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const first = polygon[i];
    const second = polygon[j];
    if (
      (first.y > point.y) !== (second.y > point.y) &&
      point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const polygonsOverlap = (first, second) => {
  const firstPolygon = getPolygon(first);
  const secondPolygon = getPolygon(second);
  if (
    first.x >= second.x + second.width ||
    first.x + first.width <= second.x ||
    first.y >= second.y + second.height ||
    first.y + first.height <= second.y
  ) {
    return false;
  }
  if (first.maskRows || second.maskRows) {
    const maskedLayer = first.maskRows ? first : second;
    const otherLayer = maskedLayer === first ? second : first;
    for (let rowIndex = 0; rowIndex < maskedLayer.maskRows.length; rowIndex += 1) {
      const y = maskedLayer.y + rowIndex;
      const runs = maskedLayer.maskRows[rowIndex] || [];
      for (const [runStart, runEnd] of runs) {
        const startX = Math.max(maskedLayer.x + runStart, otherLayer.x);
        const endX = Math.min(maskedLayer.x + runEnd, otherLayer.x + otherLayer.width);
        for (let x = startX; x < endX; x += 1) {
          if (layerContainsPixel(otherLayer, x, y)) return true;
        }
      }
    }
    return false;
  }
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < firstPolygon.length; i += 1) {
    const a = firstPolygon[i];
    const b = firstPolygon[(i + 1) % firstPolygon.length];
    for (let j = 0; j < secondPolygon.length; j += 1) {
      const c = secondPolygon[j];
      const d = secondPolygon[(j + 1) % secondPolygon.length];
      const firstSideC = cross(a, b, c);
      const firstSideD = cross(a, b, d);
      const secondSideA = cross(c, d, a);
      const secondSideB = cross(c, d, b);
      if (firstSideC * firstSideD < 0 && secondSideA * secondSideB < 0) return true;
    }
  }
  return firstPolygon.some((point) => pointInPolygon(point, secondPolygon)) ||
    secondPolygon.some((point) => pointInPolygon(point, firstPolygon));
};

const appendGridPath = (path, target) => {
  const points = path.slice();
  let current = points[points.length - 1];
  let x = current.x;
  let y = current.y;
  const dx = Math.abs(target.x - x);
  const dy = Math.abs(target.y - y);
  const sx = x < target.x ? 1 : -1;
  const sy = y < target.y ? 1 : -1;
  let stepsX = 0;
  let stepsY = 0;
  const addPoint = (point) => {
    if (points.length > 1) {
      const previous = points[points.length - 1];
      const beforePrevious = points[points.length - 2];
      const firstX = previous.x - beforePrevious.x;
      const firstY = previous.y - beforePrevious.y;
      const nextX = point.x - previous.x;
      const nextY = point.y - previous.y;
      if (firstX * nextY === firstY * nextX && firstX * nextX + firstY * nextY > 0) {
        points.pop();
      }
    }
    points.push(point);
  };
  while (x !== target.x || y !== target.y) {
    if (
      x !== target.x &&
      (y === target.y || (stepsX + 1) * dy <= (stepsY + 1) * dx)
    ) {
      x += sx;
      stepsX += 1;
    } else {
      y += sy;
      stepsY += 1;
    }
    current = { x, y };
    if (points[points.length - 1].x !== x || points[points.length - 1].y !== y) {
      addPoint(current);
    }
  }
  return points;
};

const polygonArea = (polygon) => {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
};

const maskContainsPixel = (layer, x, y) => {
  const row = layer.maskRows[y - layer.y];
  return Boolean(row && row.some(([start, end]) => x >= layer.x + start && x < layer.x + end));
};

const getMaskOutlinePath = (area) => {
  const isSelected = (x, y) => {
    if (x < 0 || x >= area.width || y < 0 || y >= area.height) return false;
    const row = area.maskRows[y] || [];
    return row.some(([start, end]) => x >= start && x < end);
  };
  const segments = [];
  for (let y = 0; y <= area.height; y += 1) {
    let start = null;
    for (let x = 0; x <= area.width; x += 1) {
      const isEdge = isSelected(x, y - 1) !== isSelected(x, y);
      if (isEdge && start === null) start = x;
      if (!isEdge && start !== null) {
        segments.push(`M${area.x + start},${area.y + y}h${x - start}`);
        start = null;
      }
    }
  }
  for (let x = 0; x <= area.width; x += 1) {
    let start = null;
    for (let y = 0; y <= area.height; y += 1) {
      const isEdge = isSelected(x - 1, y) !== isSelected(x, y);
      if (isEdge && start === null) start = y;
      if (!isEdge && start !== null) {
        segments.push(`M${area.x + x},${area.y + start}v${y - start}`);
        start = null;
      }
    }
  }
  return segments.join("");
};

const layerContainsPixel = (layer, x, y) => {
  if (layer.maskRows) return maskContainsPixel(layer, x, y);
  if (x < layer.x || x >= layer.x + layer.width || y < layer.y || y >= layer.y + layer.height) return false;
  return !layer.polygon || pointInPolygon({ x: x + 0.5, y: y + 0.5 }, layer.polygon);
};

const copyDisabledTones = (disabledTones) =>
  Object.fromEntries(Object.entries(disabledTones).map(([id, tones]) => [id, Array.from(tones)]));

export default function PixelEditor({
  image,
  renderedPreviewData,
  palette = [],
  coloursJSON,
  selectedBlocks,
  disabledTones,
  optionValue_version,
  optionValue_modeNBTOrMapdat,
  optionValue_staircasing,
  optionValue_betterColour,
  optionValue_dithering,
  optionValue_dithering_propagation_red,
  optionValue_dithering_propagation_green,
  optionValue_dithering_propagation_blue,
  optionValue_extras_moreStaircasingOptions,
  getLocaleString,
  presets = [],
  initialLayers = [],
  onChange,
}) {
  const canvasRef = useRef(null);
  const baseCanvasRef = useRef(null);
  const paintCanvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPixelRef = useRef(null);
  const selectionStartRef = useRef(null);
  const freehandPathRef = useRef([]);
  const paintActionStartRef = useRef(null);
  const paintHistoryRef = useRef([]);
  const paintHistoryIndexRef = useRef(-1);
  const skipInitialPublishRef = useRef(true);
  const lastPublishedPaintRevisionRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const editorOptionsRef = useRef(null);
  const [layers, setLayers] = useState(initialLayers);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [selectingArea, setSelectingArea] = useState(false);
  const [detectingArea, setDetectingArea] = useState(false);
  const [areaSelectionMode, setAreaSelectionMode] = useState("rectangle");
  const [selection, setSelection] = useState(null);
  const [freehandPath, setFreehandPath] = useState([]);
  const [paintColor, setPaintColor] = useState(palette[0] || null);
  const [paintTool, setPaintTool] = useState("brush");
  const [grid, setGrid] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [message, setMessage] = useState("");
  const [paintRevision, setPaintRevision] = useState(0);

  onChangeRef.current = onChange;
  editorOptionsRef.current = {
    coloursJSON,
    selectedBlocks,
    disabledTones,
  };

  useEffect(() => {
    if (!image || !image.complete || !image.naturalWidth) return;

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = image.naturalWidth;
    baseCanvas.height = image.naturalHeight;
    baseCanvas.getContext("2d").drawImage(image, 0, 0);
    const paintCanvas = document.createElement("canvas");
    paintCanvas.width = image.naturalWidth;
    paintCanvas.height = image.naturalHeight;
    baseCanvasRef.current = baseCanvas;
    paintCanvasRef.current = paintCanvas;
    paintHistoryRef.current = [];
    paintHistoryIndexRef.current = -1;
    paintActionStartRef.current = null;
  }, [image]);

  useEffect(() => {
    const baseCanvas = baseCanvasRef.current;
    if (!baseCanvas || !renderedPreviewData) return;
    if (renderedPreviewData.width !== baseCanvas.width || renderedPreviewData.height !== baseCanvas.height) return;
    baseCanvas.getContext("2d").putImageData(renderedPreviewData, 0, 0);
  }, [image, renderedPreviewData]);

  const activeLayer = layers.find((layer) => layer.id === selectedLayerId) || null;

  const composeCanvas = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const paintCanvas = paintCanvasRef.current;
    if (!baseCanvas || !paintCanvas) return null;
    const composite = document.createElement("canvas");
    composite.width = baseCanvas.width;
    composite.height = baseCanvas.height;
    const ctx = composite.getContext("2d");
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.drawImage(paintCanvas, 0, 0);
    return composite;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const composite = composeCanvas();
    if (!canvas || !composite) return;
    canvas.width = composite.width;
    canvas.height = composite.height;
    canvas.getContext("2d").drawImage(composite, 0, 0);
  }, [image, renderedPreviewData, paintRevision, composeCanvas]);

  useEffect(() => {
    const baseCanvas = baseCanvasRef.current;
    const paintCanvas = paintCanvasRef.current;
    if (!baseCanvas || !paintCanvas) return undefined;
    if (skipInitialPublishRef.current) {
      skipInitialPublishRef.current = false;
      return undefined;
    }

    const options = editorOptionsRef.current;
    const layerColoursJSON = {};
    const convertedLayers = layers.filter((layer) => layer.visible).map((layer) => {
      const aliases = {};
      const layerSelectedBlocks = {};
      const layerDisabledTones = {};
      for (const [colourSetId, blockId] of Object.entries(layer.selectedBlocks)) {
        if (blockId === "-1" || colourSetId === "61") continue;
        const alias = `layer-${layer.id}-${colourSetId}`;
        aliases[colourSetId] = alias;
        layerColoursJSON[alias] = { ...options.coloursJSON[colourSetId], baseColourSetId: colourSetId };
        layerSelectedBlocks[alias] = blockId;
        layerDisabledTones[alias] = layer.disabledTones[colourSetId] || [];
      }
      layerSelectedBlocks["61"] = options.selectedBlocks["61"] || "-1";
      layerDisabledTones["61"] = Array.from(options.disabledTones["61"] || []);
      return {
        id: layer.id,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        ...(layer.polygon && { polygon: layer.polygon }),
        ...(layer.maskRows && { maskRows: layer.maskRows }),
        aliases,
        selectedBlocks: layerSelectedBlocks,
        disabledTones: layerDisabledTones,
        betterColour: layer.betterColour,
        dithering: layer.dithering,
        ditheringPropagationRed: layer.ditheringPropagationRed,
        ditheringPropagationGreen: layer.ditheringPropagationGreen,
        ditheringPropagationBlue: layer.ditheringPropagationBlue,
      };
    });

    const paintedCanvas = paintRevision !== lastPublishedPaintRevisionRef.current ? paintCanvas : null;
    lastPublishedPaintRevisionRef.current = paintRevision;
    onChangeRef.current(convertedLayers, layerColoursJSON, layers, paintedCanvas);
  }, [layers, paintRevision]);

  const getPixelFromEvent = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    return { x, y };
  };

  const getBoundaryVertexFromEvent = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * canvas.height);
    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  };

  const paintLine = (from, to) => {
    const ctx = paintCanvasRef.current.getContext("2d");
    ctx.fillStyle = paintColor;
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      ctx.fillRect(x, y, 1, 1);
      if (x === to.x && y === to.y) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  };

  const capturePaintSnapshot = () => {
    const canvas = paintCanvasRef.current;
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  };

  const recordPaintAction = (before) => {
    const after = capturePaintSnapshot();
    let changedPixelCount = 0;
    for (let pixel = 0; pixel < before.data.length; pixel += 4) {
      if (
        before.data[pixel] === after.data[pixel] &&
        before.data[pixel + 1] === after.data[pixel + 1] &&
        before.data[pixel + 2] === after.data[pixel + 2] &&
        before.data[pixel + 3] === after.data[pixel + 3]
      ) {
        continue;
      }
      changedPixelCount += 1;
    }
    if (changedPixelCount === 0) return false;

    let action;
    if (changedPixelCount > before.data.length / 8) {
      action = { full: true, before: before.data, after: after.data };
    } else {
      const indexes = new Uint32Array(changedPixelCount);
      const beforeValues = new Uint8ClampedArray(changedPixelCount * 4);
      const afterValues = new Uint8ClampedArray(changedPixelCount * 4);
      let changedIndex = 0;
      for (let pixel = 0; pixel < before.data.length; pixel += 4) {
        if (
          before.data[pixel] === after.data[pixel] &&
          before.data[pixel + 1] === after.data[pixel + 1] &&
          before.data[pixel + 2] === after.data[pixel + 2] &&
          before.data[pixel + 3] === after.data[pixel + 3]
        ) {
          continue;
        }
        const valueIndex = changedIndex * 4;
        indexes[changedIndex] = pixel;
        beforeValues.set(before.data.subarray(pixel, pixel + 4), valueIndex);
        afterValues.set(after.data.subarray(pixel, pixel + 4), valueIndex);
        changedIndex += 1;
      }
      action = { indexes, before: beforeValues, after: afterValues };
    }

    const history = paintHistoryRef.current.slice(0, paintHistoryIndexRef.current + 1);
    history.push(action);
    paintHistoryRef.current = history;
    paintHistoryIndexRef.current = history.length - 1;
    return true;
  };

  const applyPaintHistoryAction = (action, direction) => {
    const canvas = paintCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (action.full) {
      const values = direction === "undo" ? action.before : action.after;
      context.putImageData(new ImageData(values, canvas.width, canvas.height), 0, 0);
      setPaintRevision((revision) => revision + 1);
      return;
    }
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const values = direction === "undo" ? action.before : action.after;
    for (let index = 0; index < action.indexes.length; index += 1) {
      const pixel = action.indexes[index];
      const valueIndex = index * 4;
      imageData.data[pixel] = values[valueIndex];
      imageData.data[pixel + 1] = values[valueIndex + 1];
      imageData.data[pixel + 2] = values[valueIndex + 2];
      imageData.data[pixel + 3] = values[valueIndex + 3];
    }
    context.putImageData(imageData, 0, 0);
    setPaintRevision((revision) => revision + 1);
  };

  const undoPaintAction = useCallback(() => {
    if (paintHistoryIndexRef.current < 0) return false;
    const action = paintHistoryRef.current[paintHistoryIndexRef.current];
    applyPaintHistoryAction(action, "undo");
    paintHistoryIndexRef.current -= 1;
    return true;
  }, []);

  const redoPaintAction = useCallback(() => {
    const nextIndex = paintHistoryIndexRef.current + 1;
    if (nextIndex >= paintHistoryRef.current.length) return false;
    applyPaintHistoryAction(paintHistoryRef.current[nextIndex], "redo");
    paintHistoryIndexRef.current = nextIndex;
    return true;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.key.toLowerCase() === "z" && undoPaintAction()) {
        event.preventDefault();
      } else if (event.key.toLowerCase() === "y" && redoPaintAction()) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoPaintAction, redoPaintAction]);

  const bucketFill = (startX, startY) => {
    const visibleCtx = canvasRef.current.getContext("2d");
    const imageData = visibleCtx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    const paintCtx = paintCanvasRef.current.getContext("2d");
    const data = imageData.data;
    const start = (startY * canvasRef.current.width + startX) * 4;
    const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
    const replacement = [parseInt(paintColor.slice(1, 3), 16), parseInt(paintColor.slice(3, 5), 16), parseInt(paintColor.slice(5, 7), 16), 255];
    if (target.every((channel, index) => channel === replacement[index])) return false;
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    const matches = (index) => data[index] === target[0] && data[index + 1] === target[1] && data[index + 2] === target[2] && data[index + 3] === target[3];
    const stack = [startX, startY];
    paintCtx.fillStyle = paintColor;
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      const index = (y * width + x) * 4;
      if (!matches(index)) continue;
      data[index] = replacement[0];
      data[index + 1] = replacement[1];
      data[index + 2] = replacement[2];
      data[index + 3] = replacement[3];
      paintCtx.fillRect(x, y, 1, 1);
      if (x > 0) stack.push(x - 1, y);
      if (x < width - 1) stack.push(x + 1, y);
      if (y > 0) stack.push(x, y - 1);
      if (y < height - 1) stack.push(x, y + 1);
    }
    visibleCtx.drawImage(paintCanvasRef.current, 0, 0);
    return true;
  };

  const updateActiveLayer = (changes) => {
    setLayers((current) => current.map((layer) => (layer.id === selectedLayerId ? { ...layer, ...changes } : layer)));
  };

  const updateLayerBlock = (colourSetId, blockId) => {
    if (!activeLayer) return;
    updateActiveLayer({
      selectedBlocks: { ...activeLayer.selectedBlocks, [colourSetId]: blockId },
      selectedPresetName: "None",
    });
  };

  const toggleLayerTone = (colourSetId, tone) => {
    if (!activeLayer) return;
    const disabled = new Set(activeLayer.disabledTones[colourSetId] || []);
    if (disabled.has(tone)) disabled.delete(tone);
    else disabled.add(tone);
    updateActiveLayer({
      disabledTones: { ...activeLayer.disabledTones, [colourSetId]: Array.from(disabled) },
    });
  };

  const createLayer = (area) => {
    const polygon = area.maskRows ? null : area.polygon || getPolygon(area);
    const bounds = area.maskRows
      ? {
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          maskRows: area.maskRows,
        }
      : (() => {
          const xs = polygon.map((point) => point.x);
          const ys = polygon.map((point) => point.y);
          return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            ...(area.polygon && { polygon }),
          };
        })();
    if (
      !bounds.width ||
      !bounds.height ||
      (polygon && (polygon.length < 3 || polygonArea(polygon) === 0)) ||
      (area.maskRows && !area.maskRows.some((row) => row && row.length))
    ) {
      setMessage("The outline must enclose a valid area.");
      return false;
    }
    if (layers.some((layer) => polygonsOverlap(layer, bounds))) {
      setMessage("Areas cannot overlap.");
      return false;
    }
    const id = `area-${Date.now()}-${layers.length}`;
    const layer = {
      id,
      name: area.name || `Area ${layers.length + 1}`,
      ...bounds,
      visible: true,
      selectedBlocks: { ...selectedBlocks },
      disabledTones: copyDisabledTones(disabledTones),
      selectedPresetName: "None",
      betterColour: optionValue_betterColour,
      dithering: optionValue_dithering,
      ditheringPropagationRed: optionValue_dithering_propagation_red,
      ditheringPropagationGreen: optionValue_dithering_propagation_green,
      ditheringPropagationBlue: optionValue_dithering_propagation_blue,
    };
    setLayers((current) => [...current, layer]);
    setSelectedLayerId(id);
    setSelectingArea(false);
    setSelection(null);
    setFreehandPath([]);
    freehandPathRef.current = [];
    setMessage("");
    return true;
  };

  const detectAreaFromPixel = (seed) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = canvas;
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    const seedIndex = (seed.y * width + seed.x) * 4;
    const seedAlpha = data[seedIndex + 3] / 255;
    const seedColor = [
      data[seedIndex] * seedAlpha + 255 * (1 - seedAlpha),
      data[seedIndex + 1] * seedAlpha + 255 * (1 - seedAlpha),
      data[seedIndex + 2] * seedAlpha + 255 * (1 - seedAlpha),
    ];
    const toleranceSquared = 48 * 48;
    const isAreaCandidate = (pixelIndex) => {
      const index = pixelIndex * 4;
      const alpha = data[index + 3] / 255;
      const red = data[index] * alpha + 255 * (1 - alpha);
      const green = data[index + 1] * alpha + 255 * (1 - alpha);
      const blue = data[index + 2] * alpha + 255 * (1 - alpha);
      return (
        (red - seedColor[0]) ** 2 +
        (green - seedColor[1]) ** 2 +
        (blue - seedColor[2]) ** 2 <= toleranceSquared
      );
    };
    const pixelCount = width * height;
    const mask = new Uint8Array(pixelCount);
    const stack = new Uint32Array(pixelCount);
    let stackSize = 0;
    const addCandidate = (x, y) => {
      const pixelIndex = y * width + x;
      if (mask[pixelIndex] || !isAreaCandidate(pixelIndex)) return;
      mask[pixelIndex] = 1;
      stack[stackSize] = pixelIndex;
      stackSize += 1;
    };
    addCandidate(seed.x, seed.y);
    while (stackSize > 0) {
      const pixelIndex = stack[--stackSize];
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x > 0) addCandidate(x - 1, y);
      if (x + 1 < width) addCandidate(x + 1, y);
      if (y > 0) addCandidate(x, y - 1);
      if (y + 1 < height) addCandidate(x, y + 1);
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (!mask[pixelIndex]) continue;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (maxX < minX || maxY < minY) {
      setMessage("Could not detect a connected area.");
      return;
    }
    const maskRows = [];
    for (let y = minY; y <= maxY; y += 1) {
      const runs = [];
      let runStart = null;
      for (let x = minX; x <= maxX + 1; x += 1) {
        const selected = x <= maxX && mask[y * width + x];
        if (selected && runStart === null) runStart = x;
        if (!selected && runStart !== null) {
          runs.push([runStart - minX, x - minX]);
          runStart = null;
        }
      }
      maskRows.push(runs);
    }
    if (createLayer({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      maskRows,
      name: "Detected area",
    })) {
      setMessage("");
    }
  };

  const applyAreaPreset = (presetName) => {
    if (!activeLayer) return;
    const selectedPreset = presets.find((preset) => preset.name === presetName);
    const nextSelectedBlocks = Object.fromEntries(Object.keys(coloursJSON).map((colourSetId) => [colourSetId, "-1"]));
    if (selectedPreset) {
      for (const [presetColourSetId, presetIndex] of selectedPreset.blocks) {
        const colourSetId = presetColourSetId.toString();
        const colourSet = coloursJSON[colourSetId];
        if (!colourSet) continue;
        const blockEntry = Object.entries(colourSet.blocks).find(([, block]) => block.presetIndex === presetIndex);
        if (!blockEntry) continue;
        const [blockId, block] = blockEntry;
        if (optionValue_version.MCVersion in block.validVersions) {
          nextSelectedBlocks[colourSetId] = blockId;
        }
      }
    }
    updateActiveLayer({ selectedBlocks: nextSelectedBlocks, selectedPresetName: presetName });
  };

  const onPointerDown = (event) => {
    const pixel = getPixelFromEvent(event);
    if (!pixel) return;
    if (detectingArea) {
      if (event.button !== 0) return;
      detectAreaFromPixel(pixel);
      setDetectingArea(false);
      return;
    }
    if (selectingArea) {
      if (areaSelectionMode === "freehand") {
        if (event.button !== 0) return;
        const vertex = getBoundaryVertexFromEvent(event);
        selectionStartRef.current = vertex;
        freehandPathRef.current = [vertex];
        setFreehandPath([vertex]);
      } else {
        selectionStartRef.current = pixel;
        setSelection({ x: pixel.x, y: pixel.y, width: 1, height: 1 });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (paintTool === "eyedropper") {
      const context = canvasRef.current.getContext("2d");
      const [red, green, blue] = context.getImageData(pixel.x, pixel.y, 1, 1).data;
      setPaintColor(`#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`);
      setPaintTool("brush");
      return;
    }
    if (!paintColor) return;
    if (paintTool === "bucket") {
      const before = capturePaintSnapshot();
      if (bucketFill(pixel.x, pixel.y) && recordPaintAction(before)) {
        setPaintRevision((revision) => revision + 1);
      }
      return;
    }
    paintActionStartRef.current = capturePaintSnapshot();
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPixelRef.current = pixel;
    paintLine(pixel, pixel);
    canvasRef.current.getContext("2d").drawImage(paintCanvasRef.current, 0, 0);
  };

  const onPointerMove = (event) => {
    const pixel = getPixelFromEvent(event);
    if (selectingArea && selectionStartRef.current && areaSelectionMode === "freehand") {
      const path = appendGridPath(freehandPathRef.current, getBoundaryVertexFromEvent(event));
      freehandPathRef.current = path;
      setFreehandPath(path);
      return;
    }
    if (!pixel) return;
    if (selectingArea && selectionStartRef.current) {
      const start = selectionStartRef.current;
      const x = Math.min(start.x, pixel.x);
      const y = Math.min(start.y, pixel.y);
      setSelection({ x, y, width: Math.abs(pixel.x - start.x) + 1, height: Math.abs(pixel.y - start.y) + 1 });
      return;
    }
    if (!drawingRef.current) return;
    paintLine(lastPixelRef.current || pixel, pixel);
    lastPixelRef.current = pixel;
    const canvas = canvasRef.current;
    canvas.getContext("2d").drawImage(paintCanvasRef.current, 0, 0);
  };

  const stopPointerAction = (event) => {
    if (selectingArea && selectionStartRef.current) {
      if (areaSelectionMode === "freehand") {
        const start = selectionStartRef.current;
        const path = appendGridPath(freehandPathRef.current, getBoundaryVertexFromEvent(event));
        const end = path[path.length - 1];
        const closedPath = end.x === start.x && end.y === start.y
          ? path
          : appendGridPath(path, start);
        const polygon = closedPath.slice(0, -1);
        if (createLayer({ polygon })) {
          setSelectingArea(false);
        } else {
          setSelection(null);
          setFreehandPath([]);
          freehandPathRef.current = [];
        }
      } else {
        const end = getPixelFromEvent(event) || selectionStartRef.current;
        const start = selectionStartRef.current;
        createLayer({
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x) + 1,
          height: Math.abs(end.y - start.y) + 1,
        });
      }
    }
    if (drawingRef.current && paintActionStartRef.current) {
      recordPaintAction(paintActionStartRef.current);
      paintActionStartRef.current = null;
      setPaintRevision((revision) => revision + 1);
    }
    selectionStartRef.current = null;
    drawingRef.current = false;
    lastPixelRef.current = null;
  };

  const cancelPointerAction = () => {
    if (drawingRef.current && paintActionStartRef.current) {
      recordPaintAction(paintActionStartRef.current);
      paintActionStartRef.current = null;
      setPaintRevision((revision) => revision + 1);
    }
    selectionStartRef.current = null;
    drawingRef.current = false;
    lastPixelRef.current = null;
    if (selectingArea) {
      setSelectingArea(false);
      setSelection(null);
      setFreehandPath([]);
      freehandPathRef.current = [];
    }
  };

  const zoomIn = () => setZoom((value) => Math.min(MAX_ZOOM, value * ZOOM_STEP));
  const zoomOut = () => setZoom((value) => Math.max(MIN_ZOOM, value / ZOOM_STEP));

  if (!image || !image.complete || !image.naturalWidth) return <p>No image is loaded.</p>;

  const displayWidth = image.naturalWidth * zoom;
  const displayHeight = image.naturalHeight * zoom;
  const mapMode = Object.values(MapModes).find((mode) => mode.uniqueId === optionValue_modeNBTOrMapdat);
  const staircaseModes = Object.values(mapMode.staircaseModes).filter(
    (mode) =>
      optionValue_extras_moreStaircasingOptions ||
      !mode.extra
  );
  const enabledTones = (staircasing = optionValue_staircasing) => {
    const staircase = staircaseModes.find((mode) => mode.uniqueId === staircasing);
    return staircase ? staircase.toneKeys : [];
  };
  const getLayerPalette = (layer) => {
    const staircase = Object.values(mapMode.staircaseModes).find((mode) => mode.uniqueId === optionValue_staircasing);
    if (!staircase) return [];
    const colours = [];
    for (const [colourSetId, blockId] of Object.entries(layer.selectedBlocks)) {
      if (blockId === "-1" || colourSetId === "61") continue;
      const colourSet = coloursJSON[colourSetId];
      if (!colourSet) continue;
      for (const tone of staircase.toneKeys) {
        if ((layer.disabledTones[colourSetId] || []).includes(tone) || !colourSet.tonesRGB[tone]) continue;
        const hex = `#${colourSet.tonesRGB[tone].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
        if (!colours.includes(hex)) colours.push(hex);
      }
    }
    return colours;
  };
  const paintPalette = Array.from(new Set([...palette, ...layers.flatMap(getLayerPalette)]));
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  const areaOutlines = [
    !selectingArea && selectedLayer,
    selection,
    freehandPath.length > 1 && { polygon: freehandPath, openPath: true },
  ].filter(Boolean);
  const layerSettingStyle = { display: "block", margin: "8px 0" };
  const panelStyle = {
    width: 420,
    minWidth: 320,
    flex: "0 1 420px",
    boxSizing: "border-box",
    maxHeight: "70vh",
    overflow: "auto",
    padding: 12,
    background: "#282828",
    borderRadius: 6,
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Map and Layer Editor</h2><br></br>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button
          type="button"
          aria-pressed={selectingArea && areaSelectionMode === "freehand"}
          style={selectingArea && areaSelectionMode === "freehand" ? activeToolButtonStyle : undefined}
          onClick={() => {
            const canceling = selectingArea && areaSelectionMode === "freehand";
            setDetectingArea(false);
            setAreaSelectionMode("freehand");
            setSelectingArea(!canceling);
            setSelection(null);
            setFreehandPath([]);
            freehandPathRef.current = [];
            selectionStartRef.current = null;
            setMessage(canceling ? "" : "Hold the left mouse button and trace the area outline.");
          }}
        >
          {selectingArea && areaSelectionMode === "freehand" ? "Cancel tracing" : "Trace area"}
        </button>
        <button
          type="button"
          aria-pressed={selectingArea && areaSelectionMode === "rectangle"}
          style={selectingArea && areaSelectionMode === "rectangle" ? activeToolButtonStyle : undefined}
          onClick={() => {
            const canceling = selectingArea && areaSelectionMode === "rectangle";
            setDetectingArea(false);
            setAreaSelectionMode("rectangle");
            setSelectingArea(!canceling);
            setSelection(null);
            setFreehandPath([]);
            freehandPathRef.current = [];
            selectionStartRef.current = null;
            setMessage(canceling ? "" : "Drag over the map to create a rectangular area.");
          }}
        >
          {selectingArea && areaSelectionMode === "rectangle" ? "Cancel selection" : "Rectangular area"}
        </button>
        <button
          type="button"
          aria-pressed={detectingArea}
          style={detectingArea ? activeToolButtonStyle : undefined}
          onClick={() => {
            const canceling = detectingArea;
            setDetectingArea(!canceling);
            setSelectingArea(false);
            setSelection(null);
            setFreehandPath([]);
            freehandPathRef.current = [];
            selectionStartRef.current = null;
            setMessage(canceling ? "" : "Click a pixel to detect its connected area.");
          }}
        >
          {detectingArea ? "Cancel detection" : "Detect area"}
        </button>
        <button type="button" aria-pressed={!selectingArea && !detectingArea && paintTool === "brush"} style={!selectingArea && !detectingArea && paintTool === "brush" ? activeToolButtonStyle : undefined} onClick={() => { setSelectingArea(false); setDetectingArea(false); setPaintTool("brush"); setMessage(""); }}>Brush</button>
        <button type="button" aria-pressed={!selectingArea && !detectingArea && paintTool === "bucket"} style={!selectingArea && !detectingArea && paintTool === "bucket" ? activeToolButtonStyle : undefined} onClick={() => { setSelectingArea(false); setDetectingArea(false); setPaintTool("bucket"); setMessage(""); }}>Fill</button>
        <button type="button" aria-pressed={!selectingArea && !detectingArea && paintTool === "eyedropper"} style={!selectingArea && !detectingArea && paintTool === "eyedropper" ? activeToolButtonStyle : undefined} onClick={() => { setSelectingArea(false); setDetectingArea(false); setPaintTool("eyedropper"); setMessage(""); }}>Pick color</button>
        <label>
          <input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} />
          Grid
        </label>
      </div>
      {message && <p role="status">{message}</p>}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1, overflow: "auto", maxHeight: "70vh" }}>
          <div style={{ position: "relative", width: displayWidth, height: displayHeight }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopPointerAction}
              onPointerCancel={cancelPointerAction}
              style={{
                display: "block",
                width: displayWidth,
                height: displayHeight,
                maxWidth: "none",
                imageRendering: "pixelated",
                cursor: "crosshair",
                touchAction: "none",
                backgroundColor: "white",
              }}
            />
            {grid && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  backgroundImage: `url(${IMG_GridOverlay})`,
                  backgroundRepeat: "repeat",
                  backgroundSize: `${128 * zoom}px ${128 * zoom}px`,
                  imageRendering: "pixelated",
                }}
              />
            )}
            <svg
              aria-hidden="true"
              width={displayWidth}
              height={displayHeight}
              viewBox={`0 0 ${image.naturalWidth} ${image.naturalHeight}`}
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            >
              {areaOutlines.map((area, index) => {
                if (area.maskRows) {
                  const path = getMaskOutlinePath(area);
                  return (
                    <g
                      key={`${area.id || "selection"}-${index}`}
                      fill="none"
                      strokeWidth={1 / zoom}
                      strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                      strokeLinecap="butt"
                    >
                      <path d={path} stroke="#000" />
                      <path d={path} stroke="#fff" strokeDashoffset={4 / zoom} />
                    </g>
                  );
                }
                const polygon = getPolygon(area);
                const points = polygon.map((point) => `${point.x},${point.y}`).join(" ");
                const Shape = area.openPath ? "polyline" : area.polygon ? "polygon" : "rect";
                const shapeProps = Shape === "rect"
                  ? { x: area.x, y: area.y, width: area.width, height: area.height }
                  : { points };
                return (
                  <g
                    key={`${area.id || "selection"}-${index}`}
                    fill="none"
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                    strokeLinecap="butt"
                  >
                    <Shape {...shapeProps} stroke="#000" />
                    <Shape {...shapeProps} stroke="#fff" strokeDashoffset={4 / zoom} />
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={{ display: "flex", width: displayWidth, justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span>{image.naturalWidth} × {image.naturalHeight}</span>
            <div style={{ display: "flex", gap: 2 }}>
              <div
                role="button"
                tabIndex={zoom >= MAX_ZOOM ? -1 : 0}
                aria-label="Zoom in"
                aria-disabled={zoom >= MAX_ZOOM}
                title="Zoom in"
                onClick={() => {
                  if (zoom < MAX_ZOOM) zoomIn();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (zoom < MAX_ZOOM) zoomIn();
                  }
                }}
                style={{ cursor: zoom >= MAX_ZOOM ? "default" : "pointer" }}
              >
                <img
                  alt=""
                  className="sizeButton"
                  src={IMG_Null}
                  style={{ backgroundImage: `url(${IMG_Textures})`, backgroundPosition: "-96px -2048px" }}
                />
              </div>
              <div
                role="button"
                tabIndex={zoom <= MIN_ZOOM ? -1 : 0}
                aria-label="Zoom out"
                aria-disabled={zoom <= MIN_ZOOM}
                title="Zoom out"
                onClick={() => {
                  if (zoom > MIN_ZOOM) zoomOut();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (zoom > MIN_ZOOM) zoomOut();
                  }
                }}
                style={{ cursor: zoom <= MIN_ZOOM ? "default" : "pointer" }}
              >
                <img
                  alt=""
                  className="sizeButton"
                  src={IMG_Null}
                  style={{ backgroundImage: `url(${IMG_Textures})`, backgroundPosition: "-128px -2048px" }}
                />
              </div>
            </div>
          </div>
        </div>
        <aside className="pixelEditorAreasPanel" style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Processing Areas</h3>
          {layers.length === 0 ? (
            <p>The entire image uses the global settings. Create an area to assign it different settings.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {layers.map((layer) => (
                <li key={layer.id} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <button type="button" onClick={() => setSelectedLayerId(layer.id)} aria-pressed={selectedLayerId === layer.id}>
                    {layer.name} ({layer.width} × {layer.height})
                  </button>
                  <label title="Use global settings for this area">
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(event) =>
                        setLayers((current) =>
                          current.map((item) => (item.id === layer.id ? { ...item, visible: event.target.checked } : item))
                        )
                      }
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    aria-label={`Delete ${layer.name}`}
                    onClick={() => {
                      setLayers((current) => current.filter((item) => item.id !== layer.id));
                      setSelectedLayerId((current) => (current === layer.id ? null : current));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeLayer && (
            <div>
              <hr />
              <h3>{activeLayer.name}</h3>
              <label style={layerSettingStyle}>
                Name{" "}
                <input value={activeLayer.name} maxLength={40} onChange={(event) => updateActiveLayer({ name: event.target.value })} />
              </label>
              <label style={{ ...layerSettingStyle, display: "flex", alignItems: "center", gap: 8 }}>
                Better colour{" "}
                <select
                  value={activeLayer.betterColour}
                  onChange={(event) => updateActiveLayer({ betterColour: Number(event.target.value) })}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {Object.values(ColourMethods).map((method) => (
                    <option key={method.uniqueId} value={method.uniqueId}>
                      {method.localeKey ? getLocaleString(method.localeKey) : method.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={layerSettingStyle}>
                Dithering{" "}
                <select value={activeLayer.dithering} onChange={(event) => updateActiveLayer({ dithering: Number(event.target.value) })}>
                  {Object.values(DitherMethods).map((method) => (
                    <option key={method.uniqueId} value={method.uniqueId}>
                      {method.localeKey ? getLocaleString(method.localeKey) : method.name}
                    </option>
                  ))}
                </select>
              </label>
              {[
                ["Red", "ditheringPropagationRed"],
                ["Green", "ditheringPropagationGreen"],
                ["Blue", "ditheringPropagationBlue"],
              ].map(([label, key]) => (
                <label key={key} style={layerSettingStyle}>
                  {label} propagation:   
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={activeLayer[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (value >= 0 && value <= 200) updateActiveLayer({ [key]: value });
                    }}
                    style={{ width: 56 }}
                  />
                </label>
              ))}
              <details>
                <summary style={{ cursor: "pointer", fontWeight: "bold", margin: "8px 0" }}>Blocks and tones</summary>
                <label style={layerSettingStyle}>
                  {getLocaleString("BLOCK-SELECTION/PRESETS/TITLE")}{" "}
                  <select
                    value={activeLayer.selectedPresetName || "None"}
                    onChange={(event) => applyAreaPreset(event.target.value)}
                  >
                    <option value="None">{getLocaleString("BLOCK-SELECTION/PRESETS/NONE")}</option>
                    {presets.map((preset) => (
                      <option value={preset.name} key={preset.name}>
                        {"localeKey" in preset ? getLocaleString(preset.localeKey) : preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                {Object.entries(coloursJSON)
                  .filter(([colourSetId]) => colourSetId !== "61")
                  .filter(([, colourSet]) =>
                    Object.values(colourSet.blocks).some((block) => optionValue_version.MCVersion in block.validVersions)
                  )
                  .map(([colourSetId, colourSet]) => (
                    <div key={colourSetId} style={{ marginBottom: 8 }}>
                      <div className="colourSetBlocks" style={{ alignItems: "center" }}>
                        {enabledTones()
                          .filter((tone) => colourSet.tonesRGB[tone])
                          .map((tone) => (
                            <button
                              key={tone}
                              type="button"
                              title={tone}
                              aria-label={`${colourSet.colourName || colourSet.name || `Color ${colourSetId}`}: ${tone}`}
                              aria-pressed={!(activeLayer.disabledTones[colourSetId] || []).includes(tone)}
                              onClick={() => toggleLayerTone(colourSetId, tone)}
                              className="colourSetBox"
                              style={{
                                background: `rgb(${colourSet.tonesRGB[tone].join(", ")})`,
                                cursor: "pointer",
                                padding: 0,
                                ...(!(activeLayer.disabledTones[colourSetId] || []).includes(tone) && {
                                  filter: "drop-shadow(0 0 4px #658968)",
                                }),
                              }}
                            />
                          ))}
                        {[
                          ["-1", "Do not use"],
                          ...Object.entries(colourSet.blocks)
                            .filter(([, block]) => optionValue_version.MCVersion in block.validVersions)
                            .map(([blockId]) => [blockId, colourSet.blocks[blockId].displayName]),
                        ].map(([blockId, blockName]) => (
                          <button
                            key={blockId}
                            type="button"
                            title={blockName}
                            aria-label={`${colourSet.colourName || colourSet.name || `Color ${colourSetId}`}: ${blockName}`}
                            aria-pressed={(activeLayer.selectedBlocks[colourSetId] || "-1") === blockId}
                            onClick={() => updateLayerBlock(colourSetId, blockId)}
                            style={{
                              padding: 0,
                              margin: 0,
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                            }}
                          >
                            <BlockImage
                              getLocaleString={getLocaleString}
                              coloursJSON={coloursJSON}
                              colourSetId={colourSetId}
                              blockId={blockId}
                              style={{
                                ...((activeLayer.selectedBlocks[colourSetId] || "-1") === blockId && {
                                  filter: "drop-shadow(0 0 4px #658968)",
                                  backgroundColor: "#658968",
                                }),
                              }}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </details>
            </div>
          )}

          {paintPalette.length > 0 && (
            <>
              <hr />
              <h4>Paint pixels across the entire image</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {paintPalette.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    aria-label={`Select color ${hex}`}
                    aria-pressed={paintColor === hex}
                    onClick={() => setPaintColor(hex)}
                    style={{
                      width: 24,
                      height: 24,
                      padding: 0,
                      backgroundColor: hex,
                      border: paintColor === hex ? "3px solid #fff" : "1px solid #000",
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
