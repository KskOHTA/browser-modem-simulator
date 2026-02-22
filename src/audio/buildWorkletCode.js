let _counter = 0;

/**
 * AudioWorklet コードを生成する。
 * プロセッサー名にカウンターを付与し、同一 AudioContext 内での
 * registerProcessor 二重登録 DOMException を回避する。
 *
 * @param {object} config - PROTOCOLS エントリ
 * @returns {{ code: string, processorName: string }}
 */
export function buildWorkletCode(config) {
  const processorName = `modem-proc-${++_counter}`;

  if (config.modulation === 'fsk') {
    return { code: buildFskWorklet(processorName, config), processorName };
  } else if (config.modulation === 'bpsk') {
    return { code: buildBpskWorklet(processorName, config), processorName };
  }
  throw new Error(`Unknown modulation: ${config.modulation}`);
}

function buildFskWorklet(processorName, config) {
  const { baud, fMark, fSpace, lpfAlpha, carrierThreshold } = config;
  return `
    class ModemProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.baud = ${baud};
        this.fMark = ${fMark};
        this.fSpace = ${fSpace};
        this.spb = sampleRate / this.baud;
        this.muteOutput = false;

        this.state = 'IDLE';
        this.bitTimer = 0;
        this.bitBuffer = 0;
        this.bitCount = 0;
        this.prevBit = 1;

        this.phaseM = 0;
        this.phaseS = 0;
        this.stepM = 2 * Math.PI * this.fMark / sampleRate;
        this.stepS = 2 * Math.PI * this.fSpace / sampleRate;

        this.lpf_mI = 0; this.lpf_mQ = 0;
        this.lpf_sI = 0; this.lpf_sQ = 0;
        this.dc = 0;

        this.port.onmessage = (e) => {
          if (e.data.type === 'setMuteOutput') this.muteOutput = e.data.value;
        };
      }

      process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0]) return true;

        const channelIn = input[0];
        const channelOut = output && output[0] ? output[0] : null;
        const alpha = ${lpfAlpha};
        const carrierThreshold = ${carrierThreshold};

        for (let i = 0; i < channelIn.length; i++) {
          let s = channelIn[i];

          if (channelOut && !this.muteOutput) channelOut[i] = s;

          // DCオフセット除去
          this.dc = this.dc * 0.99 + s * 0.01;
          s -= this.dc;

          // 直交検波 (I/Q ミキシング)
          const mI = s * Math.cos(this.phaseM);
          const mQ = s * Math.sin(this.phaseM);
          const sI = s * Math.cos(this.phaseS);
          const sQ = s * Math.sin(this.phaseS);

          this.phaseM += this.stepM;
          if (this.phaseM > Math.PI * 2) this.phaseM -= Math.PI * 2;
          this.phaseS += this.stepS;
          if (this.phaseS > Math.PI * 2) this.phaseS -= Math.PI * 2;

          // ローパスフィルタ
          this.lpf_mI += alpha * (mI - this.lpf_mI);
          this.lpf_mQ += alpha * (mQ - this.lpf_mQ);
          this.lpf_sI += alpha * (sI - this.lpf_sI);
          this.lpf_sQ += alpha * (sQ - this.lpf_sQ);

          // エネルギー算出
          const eM = this.lpf_mI * this.lpf_mI + this.lpf_mQ * this.lpf_mQ;
          const eS = this.lpf_sI * this.lpf_sI + this.lpf_sQ * this.lpf_sQ;
          const currentBit = eM > eS ? 1 : 0;
          const power = eM + eS;
          const hasCarrier = power > carrierThreshold;

          // UART デコード (ステートマシン)
          if (this.state === 'IDLE') {
            if (hasCarrier && currentBit === 0 && this.prevBit === 1) {
              this.state = 'START';
              this.bitTimer = this.spb * 0.5;
              this.bitBuffer = 0;
              this.bitCount = 0;
            }
          } else {
            this.bitTimer--;
            if (this.bitTimer <= 0) {
              this.bitTimer += this.spb;
              if (this.state === 'START') {
                this.state = currentBit === 0 ? 'DATA' : 'IDLE';
              } else if (this.state === 'DATA') {
                if (currentBit === 1) this.bitBuffer |= (1 << this.bitCount);
                this.bitCount++;
                if (this.bitCount === 8) this.state = 'STOP';
              } else if (this.state === 'STOP') {
                this.port.postMessage({ type: 'byte', value: this.bitBuffer });
                this.state = 'IDLE';
              }
            }
          }
          this.prevBit = currentBit;
        }
        return true;
      }
    }
    registerProcessor('${processorName}', ModemProcessor);
  `;
}

function buildBpskWorklet(processorName, config) {
  const { baud, fCarrier, lpfAlpha, carrierThreshold } = config;
  return `
    class ModemProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.baud = ${baud};
        this.fCarrier = ${fCarrier};
        this.spb = sampleRate / this.baud;
        this.muteOutput = false;

        this.state = 'IDLE';
        this.bitTimer = 0;
        this.bitBuffer = 0;
        this.bitCount = 0;
        this.prevBit = 1;

        // キャリア位相追跡
        this.phaseCarrier = 0;
        this.stepCarrier = 2 * Math.PI * this.fCarrier / sampleRate;

        // LPF ステート
        this.lpf_I = 0;
        this.lpf_Q = 0;
        this.dc = 0;

        // DPSK: 前シンボルの位相
        this.prevSymPhase = 0;

        // キャリア検出用エネルギー追跡
        this.energyLpf = 0;

        this.port.onmessage = (e) => {
          if (e.data.type === 'setMuteOutput') this.muteOutput = e.data.value;
        };
      }

      process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0]) return true;

        const channelIn = input[0];
        const channelOut = output && output[0] ? output[0] : null;
        const alpha = ${lpfAlpha};
        const carrierThreshold = ${carrierThreshold};

        for (let i = 0; i < channelIn.length; i++) {
          let s = channelIn[i];

          if (channelOut && !this.muteOutput) channelOut[i] = s;

          // DCオフセット除去
          this.dc = this.dc * 0.99 + s * 0.01;
          s -= this.dc;

          // キャリア参照信号との相関 (コスタスループ簡略版)
          const ref_I = Math.cos(this.phaseCarrier);
          const ref_Q = Math.sin(this.phaseCarrier);
          const dI = s * ref_I;
          const dQ = s * ref_Q;

          this.phaseCarrier += this.stepCarrier;
          if (this.phaseCarrier > Math.PI * 2) this.phaseCarrier -= Math.PI * 2;

          // ローパスフィルタ
          this.lpf_I += alpha * (dI - this.lpf_I);
          this.lpf_Q += alpha * (dQ - this.lpf_Q);

          // エネルギー検出 (キャリア有無)
          const energy = this.lpf_I * this.lpf_I + this.lpf_Q * this.lpf_Q;
          this.energyLpf += 0.01 * (energy - this.energyLpf);
          const hasCarrier = this.energyLpf > carrierThreshold;

          // 位相判定 → DPSK: 前シンボルとの位相差で 0/1 を判定
          const currentSymPhase = Math.atan2(this.lpf_Q, this.lpf_I);
          const phaseDiff = currentSymPhase - this.prevSymPhase;
          // cos(diff) > 0 なら位相変化なし(bit=1)、< 0 なら π シフト(bit=0)
          const currentBit = Math.cos(phaseDiff) > 0 ? 1 : 0;

          // UART デコード (ステートマシン)
          if (this.state === 'IDLE') {
            if (hasCarrier && currentBit === 0 && this.prevBit === 1) {
              this.state = 'START';
              this.bitTimer = this.spb * 0.5;
              this.bitBuffer = 0;
              this.bitCount = 0;
              this.prevSymPhase = currentSymPhase;
            }
          } else {
            this.bitTimer--;
            if (this.bitTimer <= 0) {
              this.bitTimer += this.spb;
              this.prevSymPhase = currentSymPhase; // シンボル境界で更新

              if (this.state === 'START') {
                this.state = currentBit === 0 ? 'DATA' : 'IDLE';
              } else if (this.state === 'DATA') {
                if (currentBit === 1) this.bitBuffer |= (1 << this.bitCount);
                this.bitCount++;
                if (this.bitCount === 8) this.state = 'STOP';
              } else if (this.state === 'STOP') {
                this.port.postMessage({ type: 'byte', value: this.bitBuffer });
                this.state = 'IDLE';
              }
            }
          }
          this.prevBit = currentBit;
        }
        return true;
      }
    }
    registerProcessor('${processorName}', ModemProcessor);
  `;
}
