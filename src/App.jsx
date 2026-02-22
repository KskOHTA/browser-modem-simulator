import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Zap, ShieldCheck, TerminalSquare, Trash2, Mic, MicOff } from 'lucide-react';

const MODEM_PROFILES = {
  'BELL-103': { baud: 300,  fMark: 1270, fSpace: 1070, label: 'BELL-103 (300 bps)' },
  'BELL-202': { baud: 1200, fMark: 1200, fSpace: 2200, label: 'BELL-202 (1200 bps)' },
  'V.23':     { baud: 1200, fMark: 1300, fSpace: 2100, label: 'V.23 (1200 bps)' },
  'FSK-2400': { baud: 2400, fMark: 1800, fSpace: 1400, label: 'FSK-2400 (2400 bps)' },
};

const App = () => {
  const [status, setStatus] = useState('OFFLINE');
  const [terminal, setTerminal] = useState('');
  const [txText, setTxText] = useState('MODEM LINK ESTABLISHED.\nSYNC COMPLETED.\n\n日本語のテキストも正常に送受信できます。\nこんにちは、世界！');
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState('BELL-103');
  const [isListening, setIsListening] = useState(false);
  const [rxMode, setRxMode] = useState('LOOPBACK'); // 'LOOPBACK' | 'ACOUSTIC'

  const audioCtxRef = useRef(null);
  const modemNodeRef = useRef(null);
  const sourceRef = useRef(null);
  const terminalRef = useRef(null);
  const decoderRef = useRef(new TextDecoder('utf-8'));
  const micStreamRef = useRef(null);
  const selectedProfileRef = useRef('BELL-103');

  // ターミナルのオートスクロール
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminal]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (micStreamRef.current) {
        micStreamRef.current.source.disconnect();
        micStreamRef.current.stream.getTracks().forEach(t => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const initAudio = async () => {
    if (audioCtxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;

    // FSK復調器 (AudioWorklet) — 速度・周波数はport経由で設定
    const workletCode = `
      class ModemProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          // デフォルト: BELL-103
          this.baud   = 300;
          this.fMark  = 1270;
          this.fSpace = 1070;
          this.spb    = sampleRate / this.baud;
          this.alpha  = Math.min(0.3, 2 * Math.PI * this.baud * 0.8 / sampleRate);

          this.state     = 'IDLE';
          this.bitTimer  = 0;
          this.bitBuffer = 0;
          this.bitCount  = 0;
          this.prevBit   = 1;

          // オシレータの位相とステップ
          this.phaseM = 0;
          this.phaseS = 0;
          this.stepM  = 2 * Math.PI * this.fMark  / sampleRate;
          this.stepS  = 2 * Math.PI * this.fSpace / sampleRate;

          // IIRフィルタのステート
          this.lpf_mI = 0;
          this.lpf_mQ = 0;
          this.lpf_sI = 0;
          this.lpf_sQ = 0;
          this.dc = 0;

          // portからconfig受信
          this.port.onmessage = (e) => {
            if (e.data.type === 'config') {
              this.baud   = e.data.baud;
              this.fMark  = e.data.fMark;
              this.fSpace = e.data.fSpace;
              this.spb    = sampleRate / this.baud;
              this.stepM  = 2 * Math.PI * this.fMark  / sampleRate;
              this.stepS  = 2 * Math.PI * this.fSpace / sampleRate;
              this.alpha  = Math.min(0.3, 2 * Math.PI * this.baud * 0.8 / sampleRate);
              // デコードステートとLPFをリセット
              this.state     = 'IDLE';
              this.bitTimer  = 0;
              this.bitBuffer = 0;
              this.bitCount  = 0;
              this.prevBit   = 1;
              this.lpf_mI = this.lpf_mQ = this.lpf_sI = this.lpf_sQ = 0;
              this.dc = 0;
            }
          };
        }

        process(inputs, outputs) {
          const input = inputs[0];
          const output = outputs[0];
          if (!input || !input[0]) return true;

          const channelIn  = input[0];
          const channelOut = output && output[0] ? output[0] : null;
          const alpha = this.alpha;

          for (let i = 0; i < channelIn.length; i++) {
            let s = channelIn[i];

            // スピーカーモニター出力 (常に有効)
            if (channelOut) channelOut[i] = s;

            // DCオフセット除去
            this.dc = this.dc * 0.99 + s * 0.01;
            s -= this.dc;

            // 1. 直交検波 (I/Qミキシング)
            const mI = s * Math.cos(this.phaseM);
            const mQ = s * Math.sin(this.phaseM);
            const sI = s * Math.cos(this.phaseS);
            const sQ = s * Math.sin(this.phaseS);

            this.phaseM += this.stepM;
            if (this.phaseM > Math.PI * 2) this.phaseM -= Math.PI * 2;
            this.phaseS += this.stepS;
            if (this.phaseS > Math.PI * 2) this.phaseS -= Math.PI * 2;

            // 2. ローパスフィルタ (高調波成分の除去)
            this.lpf_mI += alpha * (mI - this.lpf_mI);
            this.lpf_mQ += alpha * (mQ - this.lpf_mQ);
            this.lpf_sI += alpha * (sI - this.lpf_sI);
            this.lpf_sQ += alpha * (sQ - this.lpf_sQ);

            // 3. エネルギー算出
            const eM = this.lpf_mI * this.lpf_mI + this.lpf_mQ * this.lpf_mQ;
            const eS = this.lpf_sI * this.lpf_sI + this.lpf_sQ * this.lpf_sQ;

            const currentBit = eM > eS ? 1 : 0;
            const power = eM + eS;
            const hasCarrier = power > 0.0005;

            // 4. UART デコード (ステートマシン)
            if (this.state === 'IDLE') {
              if (hasCarrier && currentBit === 0 && this.prevBit === 1) {
                this.state     = 'START';
                this.bitTimer  = this.spb * 0.5;
                this.bitBuffer = 0;
                this.bitCount  = 0;
              }
            } else {
              this.bitTimer--;
              if (this.bitTimer <= 0) {
                this.bitTimer += this.spb;

                if (this.state === 'START') {
                  if (currentBit === 0) {
                    this.state = 'DATA';
                  } else {
                    this.state = 'IDLE';
                  }
                } else if (this.state === 'DATA') {
                  if (currentBit === 1) {
                    this.bitBuffer |= (1 << this.bitCount);
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

    // 現在のプロファイルをworkletに送信
    modemNode.port.postMessage({ type: 'config', ...MODEM_PROFILES[selectedProfileRef.current] });

    modemNode.connect(ctx.destination);
    modemNodeRef.current = modemNode;
  };

  const handleByte = (byte) => {
    try {
      const chunk = new Uint8Array([byte]);
      const str = decoderRef.current.decode(chunk, { stream: true });
      if (str) {
        setTerminal(prev => prev + str);
      }
    } catch(e) {
      console.error("Decode error", e);
    }
  };

  const handleProfileChange = (key) => {
    setSelectedProfile(key);
    selectedProfileRef.current = key;
    if (modemNodeRef.current) {
      modemNodeRef.current.port.postMessage({ type: 'config', ...MODEM_PROFILES[key] });
    }
  };

  const startListening = async () => {
    await initAudio();
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const micSource = audioCtxRef.current.createMediaStreamSource(stream);
      micSource.connect(modemNodeRef.current);
      micStreamRef.current = { stream, source: micSource };
      setIsListening(true);
      setStatus('RX ACTIVE');
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    }
  };

  const stopListening = () => {
    if (micStreamRef.current) {
      micStreamRef.current.source.disconnect();
      micStreamRef.current.stream.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    setIsListening(false);
    setStatus('ONLINE');
  };

  const transmit = async () => {
    await initAudio();
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    setIsTransmitting(true);
    setStatus('TX ACTIVE');

    const { baud, fMark, fSpace } = MODEM_PROFILES[selectedProfile];
    const encoder = new TextEncoder();
    const data = encoder.encode(txText);
    const sampleRate = audioCtxRef.current.sampleRate;
    const spb = sampleRate / baud;

    // ビット列の構築
    const bits = [];
    // キャリア同期(プリアンブル): 0.5秒間のMark
    for (let i = 0; i < Math.floor(baud * 0.5); i++) bits.push(1);

    data.forEach(byte => {
      bits.push(0); // Start bit
      for (let i = 0; i < 8; i++) {
        bits.push((byte >> i) & 1); // LSB first
      }
      bits.push(1); // Stop bit
      bits.push(1); // Margin bit
    });

    // ポストアンブル: 0.5秒間のMark
    for (let i = 0; i < Math.floor(baud * 0.5); i++) bits.push(1);

    // 音声バッファの生成 (連続位相FSK)
    const totalSamples = Math.ceil(bits.length * spb);
    const buffer = audioCtxRef.current.createBuffer(1, totalSamples, sampleRate);
    const d = buffer.getChannelData(0);

    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      const bitIndex = Math.floor(i * baud / sampleRate);
      const bit = bitIndex < bits.length ? bits[bitIndex] : 1;
      const freq = bit === 1 ? fMark : fSpace;
      const step = 2 * Math.PI * freq / sampleRate;

      d[i] = Math.sin(phase) * 0.5;
      phase += step;
      if (phase > Math.PI * 2) phase -= Math.PI * 2;
    }

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = buffer;

    // LOOPBACKモード: TX音声をdemodulatorにも接続
    if (rxMode === 'LOOPBACK') {
      source.connect(modemNodeRef.current);
    }
    // スピーカーへは常に出力 (モニター)
    source.connect(audioCtxRef.current.destination);

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

  const profile = MODEM_PROFILES[selectedProfile];

  const statusColor = {
    'OFFLINE':   'text-zinc-500',
    'ONLINE':    'text-emerald-500',
    'TX ACTIVE': 'text-yellow-500',
    'RX ACTIVE': 'text-blue-400',
  }[status] || 'text-zinc-500';

  const iconColor = {
    'OFFLINE':   'text-zinc-600',
    'ONLINE':    'text-emerald-500',
    'TX ACTIVE': 'text-yellow-500 animate-pulse',
    'RX ACTIVE': 'text-blue-400 animate-pulse',
  }[status] || 'text-zinc-600';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-400 p-4 md:p-8 font-mono">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ヘッダー */}
        <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <Zap className={iconColor} />
            <h1 className="text-xl font-bold text-white tracking-tighter">
              FSK MODEM <span className="text-zinc-500 font-normal">EMULATOR</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className={statusColor} />
            <span className={`text-[11px] font-bold uppercase tracking-widest ${statusColor}`}>
              {status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {/* 左パネル: TX + 設定 */}
          <div className="col-span-1 space-y-4">

            {/* プロファイルセレクター */}
            <div>
              <label className="block text-[10px] text-zinc-500 tracking-wider mb-1">MODEM PROFILE</label>
              <select
                value={selectedProfile}
                onChange={(e) => handleProfileChange(e.target.value)}
                disabled={isTransmitting || isListening}
                className="w-full bg-black border border-zinc-800 p-2 rounded text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {Object.entries(MODEM_PROFILES).map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* RXモードトグル */}
            <div>
              <label className="block text-[10px] text-zinc-500 tracking-wider mb-1">RX MODE</label>
              <div className="flex rounded overflow-hidden border border-zinc-800">
                <button
                  onClick={() => setRxMode('LOOPBACK')}
                  disabled={isTransmitting || isListening}
                  className={`flex-1 py-2 text-xs font-bold tracking-wider transition-colors disabled:opacity-50 ${
                    rxMode === 'LOOPBACK'
                      ? 'bg-emerald-900/50 text-emerald-400 border-r border-zinc-800'
                      : 'bg-black text-zinc-600 hover:text-zinc-400 border-r border-zinc-800'
                  }`}
                >
                  LOOPBACK
                </button>
                <button
                  onClick={() => setRxMode('ACOUSTIC')}
                  disabled={isTransmitting || isListening}
                  className={`flex-1 py-2 text-xs font-bold tracking-wider transition-colors disabled:opacity-50 ${
                    rxMode === 'ACOUSTIC'
                      ? 'bg-blue-900/50 text-blue-400'
                      : 'bg-black text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  ACOUSTIC
                </button>
              </div>
            </div>

            {/* TX Buffer */}
            <div>
              <div className="flex items-center gap-2 text-zinc-300 mb-2">
                <TerminalSquare size={16} />
                <span className="text-xs font-bold tracking-wider">TX BUFFER</span>
              </div>
              <textarea
                value={txText}
                onChange={(e) => setTxText(e.target.value)}
                disabled={isTransmitting}
                className="w-full h-40 md:h-48 bg-black border border-zinc-800 p-4 rounded text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors resize-none disabled:opacity-50"
                spellCheck="false"
              />
            </div>

            {/* TX ボタン */}
            <button
              onClick={isTransmitting ? abortTx : transmit}
              disabled={isListening}
              className={`w-full py-3 font-bold rounded flex items-center justify-center gap-2 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                isTransmitting
                  ? 'bg-zinc-800 text-red-500 hover:bg-zinc-700'
                  : 'bg-emerald-600 text-zinc-950 hover:bg-emerald-500'
              }`}
            >
              {isTransmitting ? (
                <><Square size={16} /> ABORT TX</>
              ) : (
                <><Play size={16} fill="currentColor" /> CONNECT & SEND</>
              )}
            </button>

            {/* MIC ボタン (ACOUSTICモード時のみ表示) */}
            {rxMode === 'ACOUSTIC' && (
              <button
                onClick={isListening ? stopListening : startListening}
                disabled={isTransmitting}
                className={`w-full py-3 font-bold rounded flex items-center justify-center gap-2 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                  isListening
                    ? 'bg-blue-900/60 text-red-400 hover:bg-blue-900/40 border border-blue-800'
                    : 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 border border-blue-900'
                }`}
              >
                {isListening ? (
                  <><MicOff size={16} /> STOP LISTENING</>
                ) : (
                  <><Mic size={16} /> LISTEN (MIC)</>
                )}
              </button>
            )}

            {/* 情報パネル */}
            <div className="text-[10px] text-zinc-600 leading-relaxed pt-4 border-t border-zinc-900 space-y-0.5">
              <p>PROFILE: {selectedProfile}</p>
              <p>FSK MODULATION: {profile.baud} BPS</p>
              <p>MARK: {profile.fMark} Hz / SPACE: {profile.fSpace} Hz</p>
              <p>RX MODE: {rxMode}</p>
              <p>AUDIO WORKLET DSP PROCESSING</p>
            </div>
          </div>

          {/* 右パネル: RX Terminal */}
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
              className="flex-grow bg-[#0a0f0d] border border-zinc-800 p-6 rounded h-[400px] md:h-auto overflow-y-auto shadow-inner relative"
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
