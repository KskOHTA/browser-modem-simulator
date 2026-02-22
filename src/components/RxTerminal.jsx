import { useEffect, useRef } from 'react';
import { TerminalSquare, Trash2 } from 'lucide-react';

export const RxTerminal = ({ terminal, onClear }) => {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminal]);

  return (
    <div className="col-span-1 md:col-span-2 flex flex-col">
      <div className="flex items-center justify-between text-zinc-300 mb-2">
        <div className="flex items-center gap-2">
          <TerminalSquare size={16} />
          <span className="text-xs font-bold tracking-wider">RX TERMINAL</span>
        </div>
        <button
          onClick={onClear}
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
          {terminal || (
            <span className="text-emerald-900/50 italic">Awaiting carrier signal...</span>
          )}
          <span className="inline-block w-2.5 h-5 bg-emerald-500 ml-1 align-middle animate-pulse" />
        </div>
      </div>
    </div>
  );
};
