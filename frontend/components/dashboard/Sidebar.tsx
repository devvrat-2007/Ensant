import React from 'react';
import Link from 'next/link';
import { MessageSquare, LayoutDashboard, Settings, Shield } from 'lucide-react';

export default function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-300 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-slate-800">
          <Shield className="w-6 h-6 text-blue-500 mr-3" />
          <span className="text-lg font-bold text-white tracking-wide">FlowZint</span>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-2">
          <Link href="/" className="flex items-center px-4 py-3 text-sm font-medium rounded-lg hover:bg-slate-800 hover:text-white transition-colors">
            <MessageSquare className="w-5 h-5 mr-3 text-slate-400" />
            Chat
          </Link>
          <Link href="/admin" className="flex items-center px-4 py-3 text-sm font-medium rounded-lg bg-slate-800 text-white transition-colors">
            <LayoutDashboard className="w-5 h-5 mr-3 text-blue-500" />
            Control Tower
          </Link>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button className="flex items-center w-full px-4 py-2 text-sm font-medium text-slate-400 rounded-lg hover:bg-slate-800 hover:text-white transition-colors">
            <Settings className="w-5 h-5 mr-3" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto bg-slate-950">
        {children}
      </main>
    </div>
  );
}
