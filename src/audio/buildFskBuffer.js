/**
 * FSK 送信用 Float32Array を生成する。
 * 連続位相 FSK (continuous-phase FSK) でエンコードする。
 *
 * @param {string} text - 送信テキスト (UTF-8)
 * @param {object} config - PROTOCOLS エントリ (baud, fMark, fSpace が必要)
 * @param {number} sampleRate - AudioContext のサンプルレート
 * @returns {Float32Array}
 */
export function buildFskBuffer(text, config, sampleRate) {
  const { baud, fMark, fSpace } = config;
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const spb = sampleRate / baud;

  // ビット列の構築
  const bits = [];

  // プリアンブル: 0.5 秒間の Mark (キャリア同期)
  for (let i = 0; i < Math.floor(baud * 0.5); i++) bits.push(1);

  data.forEach(byte => {
    bits.push(0); // スタートビット
    for (let i = 0; i < 8; i++) bits.push((byte >> i) & 1); // LSB first
    bits.push(1); // ストップビット
    bits.push(1); // マージンビット (安定化)
  });

  // ポストアンブル: 0.5 秒間の Mark
  for (let i = 0; i < Math.floor(baud * 0.5); i++) bits.push(1);

  // 連続位相 FSK 音声バッファ生成
  const totalSamples = Math.ceil(bits.length * spb);
  const d = new Float32Array(totalSamples);
  let phase = 0;

  for (let i = 0; i < totalSamples; i++) {
    const bitIndex = Math.floor(i * baud / sampleRate);
    const bit = bitIndex < bits.length ? bits[bitIndex] : 1;
    const freq = bit === 1 ? fMark : fSpace;
    phase += 2 * Math.PI * freq / sampleRate;
    if (phase > Math.PI * 2) phase -= Math.PI * 2;
    d[i] = Math.sin(phase) * 0.5;
  }

  return d;
}
