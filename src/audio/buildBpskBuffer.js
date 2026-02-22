/**
 * BPSK (DPSK) 送信用 Float32Array を生成する。(V.22 簡略実装)
 * 差動位相変調 (DPSK): bit=0 → 位相を π シフト、bit=1 → 位相変化なし
 *
 * @param {string} text - 送信テキスト (UTF-8)
 * @param {object} config - PROTOCOLS エントリ (baud, fCarrier が必要)
 * @param {number} sampleRate - AudioContext のサンプルレート
 * @returns {Float32Array}
 */
export function buildBpskBuffer(text, config, sampleRate) {
  const { baud, fCarrier } = config;
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const spb = sampleRate / baud;

  // ビット列の構築
  const bits = [];

  // プリアンブル: 交互 1/0 で位相基準を確立 (0.5 秒)
  for (let i = 0; i < Math.floor(baud * 0.5); i++) bits.push(i % 2);

  data.forEach(byte => {
    bits.push(0); // スタートビット
    for (let i = 0; i < 8; i++) bits.push((byte >> i) & 1); // LSB first
    bits.push(1); // ストップビット
    bits.push(1); // マージンビット
  });

  // ポストアンブル: 1 を 0.5 秒
  for (let i = 0; i < Math.floor(baud * 0.5); i++) bits.push(1);

  // BPSK 音声バッファ生成
  const totalSamples = Math.ceil(bits.length * spb);
  const d = new Float32Array(totalSamples);
  let txPhase = 0;    // キャリア位相 (累積)
  let symPhase = 0;   // DPSK シンボル位相オフセット (0 or π)
  const step = 2 * Math.PI * fCarrier / sampleRate;

  let prevSymIdx = -1;

  for (let i = 0; i < totalSamples; i++) {
    const symIdx = Math.floor(i / spb);

    // シンボル境界で位相シフトを適用
    if (symIdx !== prevSymIdx && symIdx > 0 && symIdx < bits.length) {
      // bit=0 → π シフト (位相反転)、bit=1 → 変化なし
      if (bits[symIdx] === 0) {
        symPhase = (symPhase + Math.PI) % (2 * Math.PI);
      }
      prevSymIdx = symIdx;
    } else if (prevSymIdx === -1) {
      prevSymIdx = 0;
    }

    txPhase += step;
    if (txPhase > Math.PI * 2) txPhase -= Math.PI * 2;

    d[i] = Math.sin(txPhase + symPhase) * 0.5;
  }

  return d;
}
