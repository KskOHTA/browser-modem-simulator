import { Zap, ShieldCheck, Mic, MicOff } from 'lucide-react';

export const StatusBar = ({ status, protocol, commMode, micPermission }) => {
  const isTxActive = status === 'TX ACTIVE';

  const micIcon = () => {
    if (commMode !== 'ACOUSTIC') return null;
    if (micPermission === 'granted') {
      return <Mic size={14} className="text-emerald-500" />;
    }
    if (micPermission === 'denied') {
      return <MicOff size={14} className="text-red-500" />;
    }
    if (micPermission === 'pending') {
      return <Mic size={14} className="text-yellow-500 animate-pulse" />;
    }
    return <Mic size={14} className="text-zinc-600" />;
  };

  const micLabel = () => {
    if (commMode !== 'ACOUSTIC') return null;
    const labels = {
      pending: 'REQUESTING...',
      granted: 'MIC OK',
      denied: 'MIC DENIED',
      idle: 'MIC IDLE',
    };
    const colorMap = {
      pending: 'text-yellow-500',
      granted: 'text-emerald-500',
      denied: 'text-red-500',
      idle: 'text-zinc-600',
    };
    return (
      <span className={`text-[10px] tracking-widest uppercase ${colorMap[micPermission] || 'text-zinc-600'}`}>
        {labels[micPermission] || 'MIC IDLE'}
      </span>
    );
  };

  return (
    <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
      <div className="flex items-center gap-3">
        <Zap className={isTxActive ? 'text-yellow-500 animate-pulse' : 'text-zinc-600'} />
        <h1 className="text-xl font-bold text-white tracking-tighter">
          {protocol} <span className="text-zinc-500 font-normal">EMULATOR</span>
        </h1>
      </div>

      <div className="flex items-center gap-4">
        {commMode === 'ACOUSTIC' && (
          <div className="flex items-center gap-1.5">
            {micIcon()}
            {micLabel()}
          </div>
        )}
        <div className="flex items-center gap-2">
          <ShieldCheck
            size={16}
            className={isTxActive ? 'text-yellow-500' : 'text-emerald-500'}
          />
          <span
            className={`text-[11px] font-bold uppercase tracking-widest ${
              isTxActive ? 'text-yellow-500' : 'text-emerald-500'
            }`}
          >
            {status}
          </span>
        </div>
      </div>
    </div>
  );
};
