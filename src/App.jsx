import React, { useState, useEffect, useRef } from 'react';
import { PROTOCOLS } from './audio/modemProtocols.js';
import { buildFskBuffer } from './audio/buildFskBuffer.js';
import { buildBpskBuffer } from './audio/buildBpskBuffer.js';
import { AudioEngine } from './audio/audioEngine.js';
import { StatusBar } from './components/StatusBar.jsx';
import { ModemControls } from './components/ModemControls.jsx';
import { RxTerminal } from './components/RxTerminal.jsx';

const App = () => {
  const [status, setStatus] = useState('OFFLINE');
  const [terminal, setTerminal] = useState('');
  const [txText, setTxText] = useState(
    'BELL-103 LINK ESTABLISHED.\n300 BPS SYNC COMPLETED.\n\n日本語のテキストも正常に送受信できます。\nこんにちは、世界！'
  );
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [protocol, setProtocol] = useState('BELL-103');
  const [commMode, setCommMode] = useState('LOOPBACK');
  const [micPermission, setMicPermission] = useState('idle'); // idle|pending|granted|denied

  const engineRef = useRef(null);
  const sourceRef = useRef(null);
  const decoderRef = useRef(new TextDecoder('utf-8'));

  // クリーンアップ
  useEffect(() => {
    return () => {
      engineRef.current?.teardown();
    };
  }, []);

  /** AudioEngine を遅延初期化し、指定プロトコルを読み込む */
  const getOrCreateEngine = async (config) => {
    if (!engineRef.current) {
      const engine = new AudioEngine();
      engine.onByte = handleByte;
      await engine.init();
      engineRef.current = engine;
    }
    await engineRef.current.resume();
    await engineRef.current.loadProtocol(config);
    return engineRef.current;
  };

  const handleByte = (byte) => {
    try {
      const chunk = new Uint8Array([byte]);
      const str = decoderRef.current.decode(chunk, { stream: true });
      if (str) setTerminal(prev => prev + str);
    } catch (e) {
      console.error('Decode error', e);
    }
  };

  const transmit = async () => {
    const config = PROTOCOLS[protocol];
    let engine;
    try {
      engine = await getOrCreateEngine(config);
    } catch (e) {
      console.error('AudioEngine init error', e);
      return;
    }

    setIsTransmitting(true);
    setStatus('TX ACTIVE');

    const sampleRate = engine.ctx.sampleRate;
    const rawData =
      config.modulation === 'bpsk'
        ? buildBpskBuffer(txText, config, sampleRate)
        : buildFskBuffer(txText, config, sampleRate);

    const buffer = engine.ctx.createBuffer(1, rawData.length, sampleRate);
    buffer.getChannelData(0).set(rawData);

    const source = engine.ctx.createBufferSource();
    source.buffer = buffer;
    source.onended = () => {
      setIsTransmitting(false);
      setStatus('ONLINE');
      sourceRef.current = null;
    };
    sourceRef.current = source;

    if (commMode === 'LOOPBACK') {
      engine.connectLoopback(source);
      source.start();
    } else {
      // 音響モード: マイク権限を取得してから送信開始
      setMicPermission('pending');
      try {
        await engine.connectAcoustic(source);
        setMicPermission('granted');
        source.start();
      } catch (err) {
        console.error('Microphone access denied:', err);
        setMicPermission('denied');
        setIsTransmitting(false);
        setStatus('ONLINE');
        sourceRef.current = null;
      }
    }
  };

  const abortTx = () => {
    if (sourceRef.current) {
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    setIsTransmitting(false);
    setStatus('ONLINE');
  };

  const handleProtocolChange = async (newProtocol) => {
    if (isTransmitting) abortTx();
    setProtocol(newProtocol);
    // エンジンが既に初期化済みであれば即座にリロード
    if (engineRef.current) {
      try {
        await engineRef.current.loadProtocol(PROTOCOLS[newProtocol]);
      } catch (e) {
        console.error('Protocol reload error', e);
      }
    }
  };

  const handleCommModeChange = (newMode) => {
    if (isTransmitting) abortTx();
    if (newMode === 'LOOPBACK' && engineRef.current) {
      engineRef.current.stopMic();
      setMicPermission('idle');
    }
    setCommMode(newMode);
    setStatus('OFFLINE');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-400 p-4 md:p-8 font-mono">
      <div className="max-w-5xl mx-auto space-y-6">

        <StatusBar
          status={status}
          protocol={protocol}
          commMode={commMode}
          micPermission={micPermission}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          <ModemControls
            protocol={protocol}
            commMode={commMode}
            isTransmitting={isTransmitting}
            txText={txText}
            onProtocolChange={handleProtocolChange}
            onCommModeChange={handleCommModeChange}
            onTxTextChange={setTxText}
            onTransmit={transmit}
            onAbort={abortTx}
          />

          <RxTerminal
            terminal={terminal}
            onClear={() => setTerminal('')}
          />
        </div>

      </div>
    </div>
  );
};

export default App;
