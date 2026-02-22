import { Play, Square, TerminalSquare } from 'lucide-react';
import { PROTOCOLS, PROTOCOL_KEYS, COMM_MODES } from '../audio/modemProtocols.js';

export const ModemControls = ({
  protocol,
  commMode,
  isTransmitting,
  txText,
  onProtocolChange,
  onCommModeChange,
  onTxTextChange,
  onTransmit,
  onAbort,
}) => {
  const config = PROTOCOLS[protocol];

  return (
    <div className="col-span-1 space-y-4">
      {/* プロトコル選択 */}
      <div>
        <div className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase mb-1.5">
          Protocol
        </div>
        <div className="grid grid-cols-2 gap-1">
          {PROTOCOL_KEYS.map(key => (
            <button
              key={key}
              onClick={() => onProtocolChange(key)}
              disabled={isTransmitting}
              className={`py-2 text-xs font-bold tracking-wider rounded transition-colors duration-150 ${
                protocol === key
                  ? 'bg-emerald-600 text-zinc-950'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* 通信モード選択 */}
      <div>
        <div className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase mb-1.5">
          Mode
        </div>
        <div className="grid grid-cols-2 gap-1">
          {COMM_MODES.map(mode => (
            <button
              key={mode}
              onClick={() => onCommModeChange(mode)}
              disabled={isTransmitting}
              className={`py-2 text-xs font-bold tracking-wider rounded transition-colors duration-150 ${
                commMode === mode
                  ? 'bg-zinc-300 text-zinc-950'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {mode === 'LOOPBACK' ? '↺ LOOP' : '♪ ACOUSTIC'}
            </button>
          ))}
        </div>
        {commMode === 'ACOUSTIC' && (
          <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
            スピーカーで送信し、別タブ/デバイスのマイクで受信します
          </p>
        )}
      </div>

      {/* TX バッファ */}
      <div>
        <div className="flex items-center gap-2 text-zinc-300 mb-1.5">
          <TerminalSquare size={16} />
          <span className="text-xs font-bold tracking-wider">TX BUFFER</span>
        </div>
        <textarea
          value={txText}
          onChange={(e) => onTxTextChange(e.target.value)}
          disabled={isTransmitting}
          className="w-full h-[200px] md:h-48 bg-black border border-zinc-800 p-4 rounded text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors resize-none disabled:opacity-50"
          spellCheck="false"
        />
      </div>

      {/* 送信 / アボートボタン */}
      <button
        onClick={isTransmitting ? onAbort : onTransmit}
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

      {/* テック仕様フッター */}
      <div className="text-[10px] text-zinc-600 leading-relaxed pt-4 border-t border-zinc-900">
        <p>{config.description}</p>
        <p>MODE: {commMode}</p>
        <p>AUDIO WORKLET DSP PROCESSING</p>
      </div>
    </div>
  );
};
