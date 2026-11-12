/*
 * はかり連携
 *  - keyboard : 重さをキーボード入力として送るはかり（USB / Bluetooth キーボード型）。全機種で使える
 *  - bluetooth: Web Bluetooth で直接接続（Android の Chrome のみ。iPhone / iPad の Safari は非対応）
 * 取引に使うはかりは計量法の検定に合格したもの（検定証印付き）である必要がある。
 */
(function (root) {
  'use strict';

  /**
   * はかりが送る文字列から重さ（g）を読み取る
   * 例: "ST,+0000.350 kg"（A&D形式）, "US,+00350.0  g", "350g", "0.35kg", "  350"
   * @param defaultUnit 単位が書かれていない場合の単位 'g' | 'kg'
   * @returns {grams, stable} | null
   */
  function parseWeight(text, defaultUnit) {
    if (text == null) return null;
    var s = String(text).trim();
    if (!s) return null;
    if (/^(OL|OVER)\b/i.test(s) || /\bOL\b/.test(s)) return null; // 秤量オーバー
    var m = s.match(/([+-])?\s*(\d+(?:\.\d+)?)\s*(kg|g)?/i);
    if (!m) return null;
    var v = parseFloat(m[2]);
    if (m[1] === '-') v = -v;
    var unit = (m[3] || defaultUnit || 'g').toLowerCase();
    var grams = Math.round(unit === 'kg' ? v * 1000 : v);
    var stable = !/^(US|QT)\b/i.test(s); // US = 不安定（計量中）
    return { grams: grams, stable: stable };
  }

  /**
   * Bluetooth 標準 Weight Scale Service の Weight Measurement (0x2A9D) を解析
   * @param dv DataView
   */
  function parseWeightMeasurement(dv) {
    var flags = dv.getUint8(0);
    var raw = dv.getUint16(1, true);
    if (raw === 0xFFFF) return null; // 計測失敗
    var grams = (flags & 1) ? Math.round(raw * 0.01 * 453.59237) : raw * 5; // lb(0.01) / kg(0.005)
    return { grams: grams, stable: true };
  }

  // ---------- 状態 ----------
  var listeners = [];
  var state = { connected: false, deviceName: '', reading: null, error: '' };
  var device = null;
  var textBuf = '';

  function notify() { listeners.slice().forEach(function (f) { f(state); }); }
  function onChange(f) {
    listeners.push(f);
    return function () { listeners = listeners.filter(function (x) { return x !== f; }); };
  }
  function setReading(r) {
    if (!r) return;
    state.reading = { grams: r.grams, stable: r.stable, at: Date.now() };
    notify();
  }

  /** 改行区切りの文字データを受け取り、1行ずつ解析 */
  function feedText(chunk, defaultUnit) {
    textBuf += chunk;
    var parts = textBuf.split(/[\r\n]+/);
    textBuf = parts.pop();
    if (textBuf.length > 200) textBuf = '';
    parts.forEach(function (line) { setReading(parseWeight(line, defaultUnit)); });
  }

  // ---------- Web Bluetooth ----------
  var SVC_WEIGHT = 0x181D;
  var CHR_WEIGHT = 0x2A9D;
  // シリアル通信型（文字列で重さを送る）BLEモジュールでよく使われるもの
  var SERIAL_PROFILES = [
    { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' }, // Nordic UART
    { service: 0xFFE0, notify: 0xFFE1 } // HM-10 などのシリアルモジュール
  ];

  function bluetoothSupported() { return !!(root.navigator && navigator.bluetooth && navigator.bluetooth.requestDevice); }

  function connectBluetooth(defaultUnit) {
    if (!bluetoothSupported()) {
      return Promise.reject(new Error('このブラウザはBluetooth接続に対応していません（AndroidのChromeで使えます）'));
    }
    var decoder = new TextDecoder();
    return navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SVC_WEIGHT].concat(SERIAL_PROFILES.map(function (p) { return p.service; }))
    }).then(function (d) {
      device = d;
      state.deviceName = d.name || 'はかり';
      d.addEventListener('gattserverdisconnected', function () {
        state.connected = false;
        state.error = '接続が切れました';
        notify();
      });
      return d.gatt.connect();
    }).then(function (server) {
      // 標準の体重計/はかりサービス → シリアル型 の順に試す
      return server.getPrimaryService(SVC_WEIGHT).then(function (svc) {
        return svc.getCharacteristic(CHR_WEIGHT).then(function (ch) {
          ch.addEventListener('characteristicvaluechanged', function (e) { setReading(parseWeightMeasurement(e.target.value)); });
          return ch.startNotifications();
        });
      }).catch(function () {
        return SERIAL_PROFILES.reduce(function (prev, p) {
          return prev.catch(function () {
            return server.getPrimaryService(p.service).then(function (svc) {
              return svc.getCharacteristic(p.notify);
            }).then(function (ch) {
              ch.addEventListener('characteristicvaluechanged', function (e) {
                feedText(decoder.decode(e.target.value), defaultUnit);
              });
              return ch.startNotifications();
            });
          });
        }, Promise.reject());
      });
    }).then(function () {
      state.connected = true;
      state.error = '';
      notify();
    }).catch(function (err) {
      state.connected = false;
      state.error = err && err.name === 'NotFoundError' ? '' : '接続できませんでした（対応していない機種の可能性があります）';
      notify();
      throw err;
    });
  }

  function disconnect() {
    if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
    state.connected = false;
    notify();
  }

  var Scale = {
    parseWeight: parseWeight,
    parseWeightMeasurement: parseWeightMeasurement,
    feedText: feedText,
    setReading: setReading,
    onChange: onChange,
    state: state,
    bluetoothSupported: bluetoothSupported,
    connectBluetooth: connectBluetooth,
    disconnect: disconnect
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Scale;
  else root.Scale = Scale;
})(this);
