/* Fingerprint Label Preview (static HTML + Canvas)

   Assumptions (tuned for typical 4x6 shipping labels seen in Fingerprint scripts):
   - Coordinates are given as: Y X (origin at bottom-left of label)
   - Label is 4x6 inches at 406 dpi: 1624 x 2436 dots
   - !F T S => text
   - !F B (N/E) => line segments (north/up or east/right) with thickness + length
   - !F C S => barcode placeholder (no real encoding)
*/

const LABEL = {
  widthDots: 1624,
  heightDots: 2436,
};

const FONT_BASE_PX = {
  1: 18,
  2: 22,
  3: 28,
  4: 34,
  5: 40,
  6: 50,
  7: 60,
  8: 86,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hashStringToInt(str) {
  // Simple deterministic hash (not crypto)
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parseFingerprintScript(text) {
  const commands = [];
  const warnings = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) continue;
    if (line.startsWith("//")) continue;

    // Ignore setup / control commands
    if (line.startsWith("!Y") || line === "!C" || line.startsWith("!V") || line.startsWith("!P")) {
      continue;
    }

    if (!line.startsWith("!F")) {
      continue;
    }

    // Text: !F T S <Y> <X> L <font> <xMul> <yMul> "..."
    // Example: !F T S 1911 990 L 2 1 1 "Från"
    {
      const m = line.match(/^!F\s+T\s+S\s+(-?\d+)\s+(-?\d+)\s+([A-Z])\s+(\d+)\s+(\d+)\s+(\d+)\s+\"([^\"]*)\"\s*$/);
      if (m) {
        const y = Number(m[1]);
        const x = Number(m[2]);
        const orient = m[3];
        const fontId = Number(m[4]);
        const xMul = Number(m[5]);
        const yMul = Number(m[6]);
        const value = m[7] ?? "";
        commands.push({
          type: "text",
          x,
          y,
          orient,
          fontId,
          xMul,
          yMul,
          value,
          lineNo: i + 1,
        });
        continue;
      }
    }

    // Line: !F B <N|E> <Y> <X> L <thickness> <length>
    // Example: !F B N 757 50 L 5 990
    {
      const m = line.match(/^!F\s+B\s+([A-Z])\s+(-?\d+)\s+(-?\d+)\s+L\s+(\d+)\s+(\d+)\s*$/);
      if (m) {
        const dir = m[1];
        const y = Number(m[2]);
        const x = Number(m[3]);
        const thickness = Number(m[4]);
        const length = Number(m[5]);
        if (dir !== "N" && dir !== "E") {
          warnings.push(`Line ${i + 1}: unsupported !F B direction '${dir}' (only N/E rendered).`);
          continue;
        }
        commands.push({
          type: "line",
          dir,
          x,
          y,
          thickness,
          length,
          lineNo: i + 1,
        });
        continue;
      }
    }

    // Barcode: !F C S <Y> <X> L <height> <module> <something> "data"
    // Example: !F C S 424 922 L 310 4 41  "1496046443592403759"
    {
      const m = line.match(/^!F\s+C\s+S\s+(-?\d+)\s+(-?\d+)\s+([A-Z])\s+(\d+)\s+(\d+)\s+(\d+)\s+\"([^\"]*)\"\s*$/);
      if (m) {
        const y = Number(m[1]);
        const x = Number(m[2]);
        const orient = m[3];
        const height = Number(m[4]);
        const module = Number(m[5]);
        const extra = Number(m[6]);
        const value = m[7] ?? "";
        commands.push({
          type: "barcode",
          x,
          y,
          orient,
          height,
          module,
          extra,
          value,
          lineNo: i + 1,
        });
        continue;
      }
    }

    warnings.push(`Line ${i + 1}: unparsed/ignored command: ${raw}`);
  }

  return { commands, warnings };
}

function printerToCanvas(xDots, yDots) {
  // Printer origin: bottom-left; Canvas origin: top-left
  return {
    x: xDots,
    y: LABEL.heightDots - yDots,
  };
}

function drawPaper(ctx) {
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, LABEL.widthDots, LABEL.heightDots);

  // Subtle border to resemble a label edge
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, LABEL.widthDots - 2, LABEL.heightDots - 2);
  ctx.restore();
}

function drawLineCommand(ctx, cmd) {
  const start = { x: cmd.x, y: cmd.y };
  const end = cmd.dir === "E"
    ? { x: cmd.x + cmd.length, y: cmd.y }
    : { x: cmd.x, y: cmd.y + cmd.length };

  const p1 = printerToCanvas(start.x, start.y);
  const p2 = printerToCanvas(end.x, end.y);

  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, cmd.thickness);
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
}

function drawTextCommand(ctx, cmd) {
  if (!cmd.value) return;

  const base = FONT_BASE_PX[cmd.fontId] ?? 22;
  const fontSize = base * (cmd.yMul || 1);

  const p = printerToCanvas(cmd.x, cmd.y);

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Approximate Fingerprint width scaling using xMul vs yMul
  const xScale = (cmd.xMul || 1) / (cmd.yMul || 1);
  ctx.translate(p.x, p.y);
  ctx.scale(xScale, 1);

  // Use a bold-ish weight for larger fonts to match shipping label feel
  const weight = cmd.fontId >= 6 ? 700 : 600;
  ctx.font = `${weight} ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  ctx.fillText(cmd.value, 0, 0);
  ctx.restore();
}

function estimateBarcodeWidth(cmd) {
  const module = Math.max(1, cmd.module || 2);
  const dataLen = (cmd.value || "").length;

  // Heuristic width; clamp to label bounds.
  const raw = Math.max(220, dataLen * module * 8);
  return clamp(raw, 220, LABEL.widthDots - cmd.x - 10);
}

function drawBarcodePlaceholder(ctx, cmd) {
  const p = printerToCanvas(cmd.x, cmd.y);
  const height = Math.max(40, cmd.height || 200);
  const width = estimateBarcodeWidth(cmd);

  // In printer coordinates, barcode grows "up" from baseline; on canvas that's "down".
  // We'll draw it with its bottom aligned at cmd.y.
  const topLeft = { x: p.x, y: p.y - height };

  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.fillRect(topLeft.x, topLeft.y, width, height);
  ctx.strokeRect(topLeft.x, topLeft.y, width, height);

  // Simulate bars
  const seed = hashStringToInt(cmd.value || "");
  let x = topLeft.x + 6;
  const y = topLeft.y + 4;
  const h = height - 8;

  let state = seed;
  while (x < topLeft.x + width - 6) {
    // xorshift-ish
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    const isBlack = (state & 1) === 0;
    const barW = 1 + ((state >>> 1) % Math.max(1, (cmd.module || 2) * 2));

    if (isBlack) {
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, barW, h);
    }
    x += barW;
  }

  // Human-readable value under the barcode (small)
  if (cmd.value) {
    ctx.fillStyle = "#000";
    ctx.font = `600 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const textY = topLeft.y + height + 6;
    if (textY < LABEL.heightDots - 4) {
      ctx.fillText(cmd.value, topLeft.x, textY);
    }
  }

  ctx.restore();
}

function render(commands, zoom) {
  const canvas = document.getElementById("canvas");
  const dpr = window.devicePixelRatio || 1;

  // CSS pixels
  canvas.style.width = `${LABEL.widthDots * zoom}px`;
  canvas.style.height = `${LABEL.heightDots * zoom}px`;

  // Backing store pixels
  canvas.width = Math.floor(LABEL.widthDots * zoom * dpr);
  canvas.height = Math.floor(LABEL.heightDots * zoom * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Draw in label-dot space, applying zoom + DPR via transform
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  ctx.clearRect(0, 0, LABEL.widthDots, LABEL.heightDots);

  drawPaper(ctx);

  // Draw in a stable order
  for (const cmd of commands) {
    if (cmd.type === "line") drawLineCommand(ctx, cmd);
  }
  for (const cmd of commands) {
    if (cmd.type === "barcode") drawBarcodePlaceholder(ctx, cmd);
  }
  for (const cmd of commands) {
    if (cmd.type === "text") drawTextCommand(ctx, cmd);
  }
}

function setStatus(msg, kind = "info") {
  const el = document.getElementById("status");
  if (!el) return;

  el.textContent = msg;
  el.style.color = kind === "error" ? "#ffb4b4" : kind === "warn" ? "#ffe08a" : "#aab7c6";
}

function init() {
  const input = document.getElementById("input");
  const zoomEl = document.getElementById("zoom");
  const zoomValue = document.getElementById("zoomValue");
  const renderBtn = document.getElementById("renderBtn");

  input.value = SAMPLE_INPUT.trim() + "\n";

  const doRender = () => {
    const zoom = Number(zoomEl.value);
    zoomValue.textContent = `${zoom.toFixed(2)}×`;

    const { commands, warnings } = parseFingerprintScript(input.value);
    render(commands, zoom);

    const counts = commands.reduce((acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    }, {});

    const summary = `Parsed ${commands.length} command(s): ` +
      `text=${counts.text || 0}, lines=${counts.line || 0}, barcode=${counts.barcode || 0}.`;

    if (warnings.length) {
      setStatus(summary + ` Warnings: ${warnings.length} (showing first 2): ${warnings.slice(0, 2).join(" | ")}`, "warn");
    } else {
      setStatus(summary);
    }
  };

  zoomEl.addEventListener("input", doRender);
  renderBtn.addEventListener("click", doRender);

  // Initial render
  doRender();
}

const SAMPLE_INPUT = `!Y37 0
!Y66 0
!Y17 2
!Y34 10000
!Y68 0
!Y69 -50
!Y17 2
!Y100 0
!Y9 0
!V3194
!C
!Y35 10
!Y72 2
!Y73 3
!Y74 4
!Y75 5
!Y76 6
!Y101 0
!Y102 0
!Y103 0
!Y104 0
!Y105 0
!Y106 0

!F T S 1911 990 L 2 1 1 "Från"
!F T S 1867 990 L 2 1 3 "202 Ikea Espoo"
!F T S 1818 990 L 2 1 3 "Espoontie 21"
!F T S 1768 990 L 2 1 3 "02740 Espoo"
!F T S 1737 990 L 2 1 1 "Tel:"
!F T S 1739 935 L 1 1 3 ""
!F T S 1737 493 L 2 1 1 "Avs-datum:"
!F T S 1739 370 L 1 1 3 "2025-01-31"

!F B E 1000 1675 L 10 50
!F B N 1725 960 L 10 50
!F B E 40 1675 L 10 50
!F B E 40 1226 L 10 50
!F B N 1236 40 L 10 50
!F B N 1725 40 L 10 50
!F B N 1236 960 L 10 50
!F B E 1000 1226 L 10 50

!F T S 1692 990 L 2 1 1 "Till"
!F T S 1628 990 L 3 2 3 "Felipe Gadea Llopis"
!F T S 1535 990 L 2 2 3 "Kilterinkaari 2 C 67"
!F T S 1480 990 L 2 2 3 ""

!F T S 1406 990 L 3 2 3 "01600"
!F T S 1406 770 L 3 2 3 "Vantaa"

!F T S 1250 990 L 4 3 3 "FI-Finland"

!F T S 1334 1020 L 2 2 1 ""
!F T S 1304 1020 L 2 2 1 ""
!F T S 1274 1020 L 2 2 1 ""
!F T S 1244 1020 L 2 2 1 ""

!F T S 1000 620 L 8 4 3 ""
!F T S 1000 320 L 8 4 3 ""
!F T S 1000 990 L 8 4 3 "ILSE"

!F T S 759 1020 L 2 1 1 "Sänd-ID:"
!F T S 759 925 L 2 1 3 "1496046443592379003"
!F T S 759 579 L 2 1 1 "Kolli:"
!F T S 759 509 L 2 1 3 "1"
!F T S 759 400 L 2 1 1 "Kollivikt:"
!F T S 759 279 L 3 2 3 "25,09"
!F T S 759 80 L 2 1 1 "kg"
!F B N 757 50 L 5 990

!Y42 0
!F C S 424 922 L 310 4 41  "1496046443592403759"
!F T S 389 952 L 2 1 4  "Kolli-ID:"
!F T S 285 960 L 2 2 5 "1496046443592403759"

//IKEA CDU

!F T S 2435 1020 L 1 1 3 "L-SEQ: "
!F T S 2395 1020 L 1 1 3 "LS:    "
!F T S 2355 1020 L 1 1 3 "OID:   384524072"
!F T S 2300 1020 L 2 2 3 "CDU: 42c5cb 89-54fd -4316"
!F T S 2250 1020 L 2 2 3 "Box Id: @BI@"
!F T S 2250 520 L 2 2 3 "LSC: 202"
!F T S 2200 1020 L 2 2 3 "TRIP: 202 1"
!F T S 2200 520 L 2 2 3 "GATE: @GAT@"
!F T S 2377 570 L 4 2 3 "ILSE  "

!Y42 0
!F C S 1970 952 L 220 5 41  "42c5cb89-54fd-4316-b3e8-dfbe12e32e33"
!F T S 1932 730 L 1 1 5  "42c5cb89-54fd-4316-b3e8-dfbe12e32e33"
!P 1

!C
!C`;

document.addEventListener("DOMContentLoaded", init);
