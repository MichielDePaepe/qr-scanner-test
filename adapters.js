const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { min: 1280, ideal: 1920 },
    height: { min: 720, ideal: 1080 },
  },
};
const CAMERA_CHOICE = { facingMode: 'environment' };

class Adapter {
  constructor({ video, reader, fps, onScan, onError, onMeasurement }) {
    this.video = video;
    this.reader = reader;
    this.fps = fps;
    this.scanCallback = onScan;
    this.errorCallback = onError;
    this.measurementCallback = onMeasurement;
    this.stream = null;
    this.loop = 0;
    this.stopped = false;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  onScan(callback) { this.scanCallback = callback; }
  onError(callback) { this.errorCallback = callback; }
  onMeasurement(callback) { this.measurementCallback = callback; }
  measure(elapsed) { this.measurementCallback?.(elapsed); }
  emit(value, decodeMs = null) { if (value) this.scanCallback?.(value, decodeMs); }
  fail(error) { if (error) this.errorCallback?.(error); }

  async openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Deze browser biedt geen cameratoegang via getUserMedia().');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (error) {
      if (error.name !== 'OverconstrainedError' && error.name !== 'ConstraintNotSatisfiedError') throw error;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    }
    if (this.stopped) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    return this.stream;
  }

  attachStream(stream) {
    this.stream = stream;
    this.video.srcObject = stream;
    return this.video.play();
  }

  getTrack() {
    const stream = this.stream || this.video.srcObject || this.reader?.querySelector('video')?.srcObject;
    return stream?.getVideoTracks?.()[0] || null;
  }

  async hasTorch() { return Boolean(this.getTrack()?.getCapabilities?.().torch); }

  async setTorch(enabled) {
    const track = this.getTrack();
    if (!track || !track.getCapabilities?.().torch) throw new Error('Deze camera biedt geen bediening voor de zaklamp.');
    await track.applyConstraints({ advanced: [{ torch: enabled }] });
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.loop);
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    const readerStream = this.reader?.querySelector('video')?.srcObject;
    if (readerStream && readerStream !== this.stream) readerStream.getTracks().forEach((track) => track.stop());
    if (this.video.srcObject) this.video.srcObject.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.stream = null;
  }

  async destroy() { await this.stop(); }

  schedule(frame) {
    if (this.stopped) return;
    const delay = Math.max(16, 1000 / this.fps);
    this.loop = window.setTimeout(() => {
      if (this.stopped || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return this.schedule(frame);
      frame();
    }, delay);
  }

  frameImage() {
    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const scale = Math.min(1, 960 / sourceWidth);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.drawImage(this.video, 0, 0, width, height);
    return this.context.getImageData(0, 0, width, height);
  }
}

export const scannerCatalog = [
  { id: 'html5', name: 'html5-qrcode', subtitle: 'Huidige referentie', status: 'Actief, v2.3.8' },
  { id: 'zxing', name: '@zxing/browser', subtitle: 'ZXing JavaScript', status: 'Recent bijgewerkt, v0.2.1' },
  { id: 'qrscanner', name: 'qr-scanner', subtitle: 'Nimiq · worker', status: 'Stabiele release, v1.4.2' },
  { id: 'jsqr', name: 'jsQR', subtitle: 'Canvas frame decoder', status: 'Stabiel, v1.4.0' },
  { id: 'barcode', name: 'BarcodeDetector API', subtitle: 'Native browser decoder', status: 'Experimenteel · browserafhankelijk' },
];

export async function createAdapter(id, options) {
  if (id === 'html5') return new Html5Adapter(options);
  if (id === 'zxing') return new ZxingAdapter(options);
  if (id === 'qrscanner') return new NimiqAdapter(options);
  if (id === 'jsqr') return new JsQrAdapter(options);
  if (id === 'barcode') return new BarcodeAdapter(options);
  throw new Error(`Onbekende scanner: ${id}`);
}

class Html5Adapter extends Adapter {
  async start() {
    this.stopped = false;
    await new Promise((resolve) => {
      if (window.Html5Qrcode) return resolve();
      const timeout = window.setTimeout(() => resolve(), 8000);
      window.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    if (this.stopped) return;
    if (!window.Html5Qrcode) throw new Error('html5-qrcode kon niet geladen worden. Controleer je internetverbinding en herlaad de pagina.');
    this.instance = new window.Html5Qrcode('reader', { verbose: false, formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE] });
    await this.instance.start(
      CAMERA_CHOICE,
      { fps: this.fps, qrbox: (width, height) => { const size = Math.min(width, height) * 0.72; return { width: size, height: size }; }, videoConstraints: CAMERA_CONSTRAINTS.video },
      (value) => this.emit(value),
      () => {},
    );
    if (this.stopped) {
      try { await this.instance.stop(); } catch { /* Camera request was already interrupted. */ }
      await super.stop();
      return;
    }
    this.stream = this.reader.querySelector('video')?.srcObject || null;
  }
  async stop() {
    this.stopped = true;
    if (this.instance?.isScanning) {
      try { await this.instance.stop(); } catch (error) { this.fail(error); }
    }
    await super.stop();
  }
  async destroy() { await this.stop(); this.instance?.clear(); this.instance = null; }
}

class ZxingAdapter extends Adapter {
  async start() {
    this.stopped = false;
    const { BrowserQRCodeReader } = await import('https://esm.sh/@zxing/browser@0.2.1');
    if (this.stopped) return;
    this.readerInstance = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: Math.round(1000 / this.fps) });
    const onDecode = (result, error) => {
      if (result) this.emit(result.getText());
      else if (error && error.name !== 'NotFoundException' && error.name !== 'ChecksumException' && error.name !== 'FormatException') this.fail(error);
    };
    await this.openCamera();
    if (this.stopped) return;
    const controls = await this.readerInstance.decodeFromVideoElement(this.video, onDecode);
    this.controls = controls;
    if (this.stopped) {
      this.controls.stop();
      this.controls = null;
      await super.stop();
    }
  }
  async stop() {
    this.stopped = true;
    this.controls?.stop();
    this.controls = null;
    await super.stop();
  }
  async hasTorch() { return Boolean(this.controls?.switchTorch || await super.hasTorch()); }
  async setTorch(enabled) {
    if (this.controls?.switchTorch) return this.controls.switchTorch(enabled);
    return super.setTorch(enabled);
  }
  async destroy() { await this.stop(); this.readerInstance = null; }
}

class NimiqAdapter extends Adapter {
  async start() {
    this.stopped = false;
    const module = await import('https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js');
    if (this.stopped) return;
    const QrScanner = module.default;
    this.scanner = new QrScanner(this.video, (result) => this.emit(typeof result === 'string' ? result : result.data), {
      preferredCamera: 'environment',
      maxScansPerSecond: this.fps,
      returnDetailedScanResult: true,
      highlightScanRegion: false,
      highlightCodeOutline: false,
      calculateScanRegion: (video) => {
        const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * 0.9);
        return { x: Math.round((video.videoWidth - side) / 2), y: Math.round((video.videoHeight - side) / 2), width: side, height: side, downScaledWidth: 720, downScaledHeight: 720 };
      },
    });
    await this.scanner.start();
    this.stream = this.video.srcObject;
    if (this.stopped) { this.scanner.stop(); await super.stop(); }
  }
  async stop() {
    this.stopped = true;
    this.scanner?.stop();
    await super.stop();
  }
  async hasTorch() { return Boolean(await this.scanner?.hasFlash?.() || await super.hasTorch()); }
  async setTorch(enabled) {
    if (await this.scanner?.hasFlash?.()) return enabled ? this.scanner.turnFlashOn() : this.scanner.turnFlashOff();
    return super.setTorch(enabled);
  }
  async destroy() { await this.stop(); this.scanner?.destroy(); this.scanner = null; }
}

class JsQrAdapter extends Adapter {
  async start() {
    this.stopped = false;
    const { default: jsQR } = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
    if (this.stopped) return;
    this.decoder = jsQR;
    await this.openCamera();
    const tick = () => {
      if (this.stopped) return;
      let frame;
      try { frame = this.frameImage(); } catch (error) { this.fail(error); return this.schedule(tick); }
      if (frame) {
        const started = performance.now();
        try {
          const result = this.decoder(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
          const elapsed = performance.now() - started;
          this.measure(elapsed);
          if (result) this.emit(result.data, elapsed);
        } catch (error) { this.fail(error); }
      }
      this.schedule(tick);
    };
    this.schedule(tick);
  }
}

class BarcodeAdapter extends Adapter {
  async start() {
    if (!('BarcodeDetector' in window)) throw new Error('BarcodeDetector wordt niet ondersteund door deze browser. Probeer een andere scanner of browser.');
    this.stopped = false;
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (this.stopped) return;
    if (!formats.includes('qr_code')) throw new Error('Deze browser ondersteunt BarcodeDetector, maar geen QR-codeformaat.');
    this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    await this.openCamera();
    if (this.stopped) return;
    const tick = async () => {
      if (this.stopped) return;
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const started = performance.now();
        try {
          const results = await this.detector.detect(this.video);
          const elapsed = performance.now() - started;
          this.measure(elapsed);
          if (results[0]) this.emit(results[0].rawValue, elapsed);
        } catch (error) { this.fail(error); }
      }
      if (!this.stopped) this.schedule(tick);
    };
    this.schedule(tick);
  }
}
