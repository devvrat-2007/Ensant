import React from 'react';

interface LogEntry {
  id: string;
  time: string;
  user: string;
  action: string;
  status: string;
}

export default function LogFeed({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-800">
        <h2 className="text-lg font-semibold text-white">Audit Trail</h2>
        <p className="text-sm text-slate-400 mt-1">Recent system invocations</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50 border-b border-slate-800">
            <tr>
              <th className="px-6 py-4 font-semibold">Event ID</th>
              <th className="px-6 py-4 font-semibold">Timestamp</th>
              <th className="px-6 py-4 font-semibold">User Hash</th>
              <th className="px-6 py-4 font-semibold">Action Preview</th>
              <th className="px-6 py-4 font-semibold text-right">Status</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  No recent activity logged.
                </td>
              </tr>
            ) : (
              logs.map((log, idx) => (
                <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/25 transition-colors">
                  <td className="px-6 py-4 text-blue-400">{log.id}</td>
                  <td className="px-6 py-4 text-slate-400">{log.time}</td>
                  <td className="px-6 py-4 text-slate-300">{log.user}</td>
                  <td className="px-6 py-4 text-slate-300 truncate max-w-[250px]">{log.action}</td>
                  <td className="px-6 py-4 text-right">
                    <span className="bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-md">
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
