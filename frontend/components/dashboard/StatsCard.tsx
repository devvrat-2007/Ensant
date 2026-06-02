import React from 'react';
import { Activity, Clock, Database, Server } from 'lucide-react';

interface StatsCardProps {
  label: string;
  value: string;
  trend: string;
  icon_name: string;
}

const getIcon = (name: string) => {
  switch (name) {
    case 'activity': return <Activity className="w-5 h-5 text-blue-500" />;
    case 'clock': return <Clock className="w-5 h-5 text-blue-500" />;
    case 'database': return <Database className="w-5 h-5 text-blue-500" />;
    case 'server': return <Server className="w-5 h-5 text-blue-500" />;
    default: return <Activity className="w-5 h-5 text-blue-500" />;
  }
};

export default function StatsCard({ label, value, trend, icon_name }: StatsCardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400">{label}</h3>
        <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">
          {getIcon(icon_name)}
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-3xl font-bold text-white font-mono">{value}</span>
        <span className="text-xs text-emerald-500 mt-2 font-medium bg-emerald-500/10 w-fit px-2 py-1 rounded-full">
          {trend}
        </span>
      </div>
    </div>
  );
}
