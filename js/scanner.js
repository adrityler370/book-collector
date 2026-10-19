// Barcode reading: live camera (getUserMedia) or a still photo. Uses the browser's BarcodeDetector when it
// reads EAN-13 (Chrome on Android) and ZXing everywhere else (Safari on iPhone).
(function (root) {
  "use strict";

  const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
  let stream = null;
  let running = false;
  let timer = null;
  let detectorP = null;
  let zx = null;

  function nativeDetector() {
    if (!detectorP) {
      detectorP = (async () => {
        if (!("BarcodeDetector" in root)) return null;
        try {
          const supported = await root.BarcodeDetector.getSupportedFormats();
          if (!supported.includes("ean_13")) return null;
          return new root.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
        } catch {
          return null;
        }
      })();
    }
    return detectorP;
  }

  function zxingReader(tryHarder) {
    const Z = root.ZXing;
    if (!Z) return null;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]);
    if (tryHarder) hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const r = new Z.MultiFormatReader();
    r.setHints(hints);
    return r;
  }

  function zxingDecode(canvas, reader) {
    const Z = root.ZXing;
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decodeWithState(bmp).getText();
    } catch {
      return null; // NotFoundException on frames without a barcode
    } finally {
      reader.reset();
    }
  }

  // Draws the central band of the frame (where the on-screen guide is), scaled down for speed.
  const work = document.createElement("canvas");
  function drawBand(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const sw = vw * 0.9, sh = Math.min(vh * 0.45, sw * 0.6);
    const scale = Math.min(1, 900 / sw);
    work.width = Math.round(sw * scale);
    work.height = Math.round(sh * scale);
    const ctx = work.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, work.width, work.height);
    return work;
  }

  async function readFrame(video) {
    const det = await nativeDetector();
    if (det) {
      const codes = await det.detect(video).catch(() => []);
      return codes.length ? codes[0].rawValue : null;
    }
    const band = drawBand(video);
    if (!band) return null;
    zx = zx || zxingReader(false);
    return zx ? zxingDecode(band, zx) : null;
  }

  const Scanner = {
    canUseCamera() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && root.isSecureContext !== false;
    },

    // Starts the rear camera in `video` and calls onCode(text) for every barcode read (the caller decides
    // when to stop). Rejects with the getUserMedia error (NotAllowedError, NotFoundError, ...).
    async start(video, onCode) {
      await Scanner.stop();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.muted = true;
      await video.play();
      running = true;
      const loop = async () => {
        if (!running) return;
        let code = null;
        try { code = await readFrame(video); } catch { /* keep scanning */ }
        if (code && running) onCode(code);
        if (running) timer = setTimeout(loop, 120);
      };
      loop();
    },

    async stop() {
      running = false;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    },

    torchAvailable() {
      const track = stream && stream.getVideoTracks()[0];
      try { return !!(track && track.getCapabilities && track.getCapabilities().torch); } catch { return false; }
    },

    async setTorch(on) {
      const track = stream && stream.getVideoTracks()[0];
      if (track) await track.applyConstraints({ advanced: [{ torch: !!on }] });
    },

    // Reads a barcode from a photo file; tries the photo as taken and turned 90°. Resolves the text or null.
    async decodeFile(file) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("image"));
          i.src = url;
        });
        const det = await nativeDetector();
        if (det) {
          const codes = await det.detect(img).catch(() => []);
          if (codes.length) return codes[0].rawValue;
        }
        const reader = zxingReader(true);
        if (!reader) return null;
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        const c = document.createElement("canvas");
        for (const turned of [false, true]) {
          c.width = turned ? h : w;
          c.height = turned ? w : h;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (turned) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
          ctx.drawImage(img, 0, 0, w, h);
          const text = zxingDecode(c, reader);
          if (text) return text;
        }
        return null;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };

  root.Scanner = Scanner;
})(this);
