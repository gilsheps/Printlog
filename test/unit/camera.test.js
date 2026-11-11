// Generic camera transport: every Bambu model maps to RTSP or the port-6000
// chamber image the same way Home Assistant's pybambu does — never P2S-only.
const assert = require('assert');
const { printerType, camTransport } = require('../../app/camera.js');

// model detection from the reported modules (product_name), like pybambu
const mods = (product, extra = {}) => ({ modules: [{ name: 'ota', product, ...extra }] });
assert.strictEqual(printerType(mods('Bambu Lab P2S')), 'P2S');
assert.strictEqual(printerType(mods('Bambu Lab P1S')), 'P1S');
assert.strictEqual(printerType(mods('Bambu Lab A1 mini')), 'A1MINI');
assert.strictEqual(printerType(mods('Bambu Lab H2D')), 'H2D');
assert.strictEqual(printerType(mods('Bambu Lab X1 Carbon')), 'X1C');

// legacy board codes
assert.strictEqual(printerType({ modules: [{ name: 'esp32', hw: 'AP04', project: 'C11' }] }), 'P1P');
assert.strictEqual(printerType({ modules: [{ name: 'ap', hw: 'AP02' }] }), 'X1E');

// fall back to the stored model string
assert.strictEqual(printerType({ model: 'P2S' }), 'P2S');
assert.strictEqual(printerType({ model: 'Bambu Lab P1S' }), 'P1S');

// RTSP family -> rtsp, chamber-image family -> image, unknown -> auto (probe both)
assert.strictEqual(camTransport(mods('Bambu Lab P2S')).how, 'rtsp');
assert.strictEqual(camTransport(mods('Bambu Lab X1 Carbon')).how, 'rtsp');
assert.strictEqual(camTransport(mods('Bambu Lab H2S')).how, 'rtsp');
assert.strictEqual(camTransport(mods('Bambu Lab P1S')).how, 'image');
assert.strictEqual(camTransport(mods('Bambu Lab A1')).how, 'image');
assert.strictEqual(camTransport({ model: 'something new' }).how, 'probe');

// a definitive signal in the printer's own report always wins over the model guess
assert.strictEqual(camTransport({ report: { ipcam: { liveview: { local: 'rtsps' } } }, model: 'A1' }).how, 'rtsp');
assert.strictEqual(camTransport({ report: { ipcam: { liveview: { local: 'local' } } }, model: 'P2S' }).how, 'image');
// liveview disabled on an RTSP model (the P2S) -> genuinely off, like Home Assistant
assert.strictEqual(camTransport({ report: { ipcam: { rtsp_url: 'disable' } }, ...mods('Bambu Lab P2S') }).how, 'off');
assert.strictEqual(camTransport({ report: { ipcam: { liveview: { local: 'disabled' } } }, ...mods('Bambu Lab P2S') }).how, 'off');
// but a chamber-image model ignores that switch -> still try port 6000
assert.strictEqual(camTransport({ report: { ipcam: { rtsp_url: 'disable' } }, ...mods('Bambu Lab A1') }).how, 'image');

console.log('camera transport ok');
