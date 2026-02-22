import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Zap, ShieldCheck, TerminalSquare, Trash2 } from 'lucide-react';

const BAUD = 300;
const F_MARK = 1270;
const F_SPACE = 1070;

const App = () => {
  const [status, setStatus] = useState('OFFLINE');
  const [terminal, setTerminal] = useState('');
  const [txText, setTxText] = useState('BELL-103 LINK ESTABLISHED.\n300 BPS SYNC COMPLETED.\n\n日本語のテキストも正常に送受信できます。\nこんにちは、世界！');
  const [isTransmitting, setIsTransmitting] = useState(false);

  const audioCtxRef = useRef(null);
  const modemNodeRef = useRef(null);
  const sourceRef = useRef(null);
  const terminalRef = useRef(null);
  const decoderRef = useRef(new TextDecoder('utf-8'));

  // ターミナルのオートスクロール
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminal]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const initAudio = async () => {
    if (audioCtxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;

    // FSK復調器 (AudioWorklet)
    const workletCode = `
      class ModemProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.baud = ${BAUD};
          this.fMark = ${F_MARK};
          this.fSpace = ${F_SPACE};
          this.spb = sampleRate / this.baud;

          this.state = 'IDLE'; // IDLE, START, DATA, STOP
          this.bitTimer = 0;
          this.bitBuffer = 0;
          this.bitCount = 0;
          this.prevBit = 1;

          // オシレータの位相とステップ
          this.phaseM = 0;
          this.phaseS = 0;
          this.stepM = 2 * Math.PI * this.fMark / sampleRate;
          this.stepS = 2 * Math.PI * this.fSpace / sampleRate;

          // IIRフィルタのステート
          this.lpf_mI = 0;
          this.lpf_mQ = 0;
          this.lpf_sI = 0;
          this.lpf_sQ = 0;
          this.dc = 0;
        }

        process(inputs, outputs) {
          const input = inputs[0];
          const output = outputs[0];
          if (!input || !input[0]) return true;

          const channelIn = input[0];
          const channelOut = output && output[0] ? output[0] : null;

          for (let i = 0; i < channelIn.length; i++) {
            let s = channelIn[i];

            // スピーカー出力
            if (channelOut) channelOut[i] = s;

            // DCオフセット除去
            this.dc = this.dc * 0.99 + s * 0.01;
            s -= this.dc;

            // 1. 直交検波 (I/Qミキシング - 周波数シフト)
            const mI = s * Math.cos(this.phaseM);
            const mQ = s * Math.sin(this.phaseM);
            const sI = s * Math.cos(this.phaseS);
            const sQ = s * Math.sin(this.phaseS);

            this.phaseM += this.stepM;
            if (this.phaseM > Math.PI * 2) this.phaseM -= Math.PI * 2;
            this.phaseS += this.stepS;
            if (this.phaseS > Math.PI * 2) this.phaseS -= Math.PI * 2;

            // 2. ローパスフィルタ (高調波成分の除去)
            // LPFを掛けてから二乗和を取らないと周波数を判別できない
            const alpha = 0.05;
            this.lpf_mI += alpha * (mI - this.lpf_mI);
            this.lpf_mQ += alpha * (mQ - this.lpf_mQ);
            this.lpf_sI += alpha * (sI - this.lpf_sI);
            this.lpf_sQ += alpha * (sQ - this.lpf_sQ);

            // 3. エネルギー算出
            const eM = this.lpf_mI * this.lpf_mI + this.lpf_mQ * this.lpf_mQ;
            const eS = this.lpf_sI * this.lpf_sI + this.lpf_sQ * this.lpf_sQ;

            const currentBit = eM > eS ? 1 : 0; // Mark(1270Hz)=1, Space(1070Hz)=0
            const power = eM + eS;
            const hasCarrier = power > 0.0005; // キャリア検出のしきい値

            // 4. UART デコード (ステートマシン)
            if (this.state === 'IDLE') {
              // 1(Mark)から0(Space)への立ち下がりエッジを検出 = スタートビットの開始
              if (hasCarrier && currentBit === 0 && this.prevBit === 1) {
                this.state = 'START';
                this.bitTimer = this.spb * 0.5; // スタートビットの中央へタイマーをセット
                this.bitBuffer = 0;
                this.bitCount = 0;
              }
            } else {
              this.bitTimer--;
              if (this.bitTimer <= 0) {
                this.bitTimer += this.spb; // 次のビットの中央へ

                if (this.state === 'START') {
                  if (currentBit === 0) {
                    this.state = 'DATA'; // 本当にスタートビットだった
                  } else {
                    this.state = 'IDLE'; // ノイズだった場合はリセット
                  }
                } else if (this.state === 'DATA') {
                  if (currentBit === 1) {
                    this.bitBuffer |= (1 << this.bitCount); // LSB First
                  }
                  this.bitCount++;
                  if (this.bitCount === 8) {
                    this.state = 'STOP';
                  }
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
      registerProcessor('modem-processor', ModemProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);

    const modemNode = new AudioWorkletNode(ctx, 'modem-processor');
    modemNode.port.onmessage = (e) => {
      if (e.data.type === 'byte') handleByte(e.data.value);
    };

    modemNode.connect(ctx.destination);
    modemNodeRef.current = modemNode;
  };

  const handleByte = (byte) => {
    try {
      // ストリームデコードにより、マルチバイト文字（日本語など）が分割されても正しく待機・結合される
      const chunk = new Uint8Array([byte]);
      const str = decoderRef.current.decode(chunk, { stream: true });
      if (str) {
        setTerminal(prev => prev + str);
      }
    } catch(e) {
      console.error("Decode error", e);
    }
  };

  const transmit = async () => {
    await initAudio();
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    setIsTransmitting(true);
    setStatus('TX ACTIVE');

    const encoder = new TextEncoder();
    const data = encoder.encode(txText);
    const sampleRate = audioCtxRef.current.sampleRate;
    const spb = sampleRate / BAUD;

    // ビット列の構築
    const bits = [];
    // キャリア同期(プリアンブル): 0.5秒間のMark
    for (let i = 0; i < Math.floor(BAUD * 0.5); i++) bits.push(1);

    data.forEach(byte => {
      bits.push(0); // Start bit
      for (let i = 0; i < 8; i++) {
        bits.push((byte >> i) & 1); // LSB first
      }
      bits.push(1); // Stop bit
      bits.push(1); // Margin bit (安定化のため)
    });

    // ポストアンブル: 0.5秒間のMark
    for (let i = 0; i < Math.floor(BAUD * 0.5); i++) bits.push(1);

    // 音声バッファの生成 (連続位相FSK)
    const totalSamples = Math.ceil(bits.length * spb);
    const buffer = audioCtxRef.current.createBuffer(1, totalSamples, sampleRate);
    const d = buffer.getChannelData(0);

    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      const bitIndex = Math.floor(i * BAUD / sampleRate);
      const bit = bitIndex < bits.length ? bits[bitIndex] : 1;
      const freq = bit === 1 ? F_MARK : F_SPACE;
      const step = 2 * Math.PI * freq / sampleRate;

      d[i] = Math.sin(phase) * 0.5;
      phase += step;
      if (phase > Math.PI * 2) phase -= Math.PI * 2;
    }

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(modemNodeRef.current);
    source.onended = () => {
      setIsTransmitting(false);
      setStatus('ONLINE');
      sourceRef.current = null;
    };
    sourceRef.current = source;
    source.start();
  };

  const abortTx = () => {
    if (sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    setIsTransmitting(false);
    setStatus('ONLINE');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-400 p-4 md:p-8 font-mono">
      <div className="max-w-5xl mx-auto space-y-6">

        <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <Zap className={status === 'TX ACTIVE' ? 'text-yellow-500 animate-pulse' : 'text-zinc-600'} />
            <h1 className="text-xl font-bold text-white tracking-tighter">
              BELL-103 <span className="text-zinc-500 font-normal">EMULATOR</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className={status === 'TX ACTIVE' ? 'text-yellow-500' : 'text-emerald-500'} />
            <span className={`text-[11px] font-bold uppercase tracking-widest ${status === 'TX ACTIVE' ? 'text-yellow-500' : 'text-emerald-500'}`}>
              {status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          <div className="col-span-1 space-y-4">
            <div className="flex items-center gap-2 text-zinc-300 mb-2">
              <TerminalSquare size={16} />
              <span className="text-xs font-bold tracking-wider">TX BUFFER</span>
            </div>
            <textarea
              value={txText}
              onChange={(e) => setTxText(e.target.value)}
              disabled={isTransmitting}
              className="w-full h-[250px] md:h-64 bg-black border border-zinc-800 p-4 rounded text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors resize-none disabled:opacity-50"
              spellCheck="false"
            />
            <button
              onClick={isTransmitting ? abortTx : transmit}
              className={`w-full py-4 font-bold rounded flex items-center justify-center gap-2 transition-colors duration-200 ${
                isTransmitting
                  ? 'bg-zinc-800 text-red-500 hover:bg-zinc-700'
                  : 'bg-emerald-600 text-zinc-950 hover:bg-emerald-500'
              }`}
            >
              {isTransmitting ? (
                <><Square size={18} /> ABORT TX</>
              ) : (
                <><Play size={18} fill="currentColor" /> CONNECT & SEND</>
              )}
            </button>

            <div className="text-[10px] text-zinc-600 leading-relaxed pt-4 border-t border-zinc-900">
              <p>FSK MODULATION: 300 BPS</p>
              <p>MARK: 1270 Hz / SPACE: 1070 Hz</p>
              <p>AUDIO WORKLET DSP PROCESSING</p>
            </div>
          </div>

          <div className="col-span-1 md:col-span-2 flex flex-col">
            <div className="flex items-center justify-between text-zinc-300 mb-2">
              <div className="flex items-center gap-2">
                <TerminalSquare size={16} />
                <span className="text-xs font-bold tracking-wider">RX TERMINAL</span>
              </div>
              <button
                onClick={() => setTerminal('')}
                className="text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1 text-[10px] tracking-wider"
              >
                <Trash2 size={12} /> CLEAR
              </button>
            </div>

            <div
              ref={terminalRef}
              className="flex-grow bg-[#0a0f0d] border border-zinc-800 p-6 rounded h-[350px] md:h-auto overflow-y-auto shadow-inner relative"
            >
              <div className="text-emerald-500 text-base md:text-lg leading-relaxed whitespace-pre-wrap break-all">
                {terminal || <span className="text-emerald-900/50 italic">Awaiting carrier signal...</span>}
                <span className="inline-block w-2.5 h-5 bg-emerald-500 ml-1 align-middle animate-pulse" />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;
