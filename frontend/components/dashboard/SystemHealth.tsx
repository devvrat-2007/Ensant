import React from 'react';

interface HealthStatus {
  name: string;
  status: string;
  uptime: string;
}

export default function SystemHealth({ healthData }: { healthData: HealthStatus[] }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm flex flex-col h-full">
      <div className="p-6 border-b border-slate-800">
        <h2 className="text-lg font-semibold text-white">System Health</h2>
        <p className="text-sm text-slate-400 mt-1">Live infrastructure status</p>
      </div>
      <div className="p-6 flex-1 space-y-6">
        {healthData.map((service, idx) => (
          <div key={idx} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${service.status === 'operational' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-3 w-3 ${service.status === 'operational' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
              <span className="text-sm font-medium text-slate-200">{service.name}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs text-slate-500 font-mono">UPTIME</span>
              <span className="text-sm text-slate-300 font-mono">{service.uptime}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
