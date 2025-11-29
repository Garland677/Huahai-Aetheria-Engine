
import React from 'react';
import { DebugLog } from '../../types';
import { X, Terminal, MessageSquare } from 'lucide-react';

interface DevConsoleProps {
    logs: DebugLog[];
    onClose: () => void;
}

export const DevConsole: React.FC<DevConsoleProps> = ({ logs, onClose }) => {
    const renderContent = (content: any) => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content.map((part, i) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    if ('text' in part) return part.text;
                    return JSON.stringify(part);
                }
                return String(part);
            }).join('');
        }
        if (content && typeof content === 'object') {
             if ('text' in content) return content.text;
             return JSON.stringify(content);
        }
        return String(content || "");
    };

    const formatPrompt = (prompt: string) => {
        try {
            // Attempt to parse as JSON to check if it's a structured message array
            const parsed = JSON.parse(prompt);
            if (Array.isArray(parsed)) {
                return (
                    <div className="flex flex-col gap-2 mt-1">
                        {parsed.map((msg: any, idx: number) => (
                            <div key={idx} className="flex flex-col border border-slate-700 rounded overflow-hidden text-[10px]">
                                <div className={`px-2 py-1 font-bold uppercase ${msg.role === 'system' ? 'bg-red-900/30 text-red-400' : msg.role === 'model' || msg.role === 'assistant' ? 'bg-teal-900/30 text-teal-400' : 'bg-blue-900/30 text-blue-400'}`}>
                                    {msg.role}
                                </div>
                                <div className="p-2 bg-black/20 whitespace-pre-wrap text-slate-300 font-mono">
                                    {renderContent(msg.parts || msg.content)}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            }
        } catch (e) {
            // Not JSON, return plain text
        }
        return <pre className="whitespace-pre-wrap text-gray-400 font-mono text-xs">{prompt}</pre>;
    };

    return (
        <div className="absolute bottom-0 left-0 w-full h-[60vh] bg-gray-950 border-t border-indigo-900 shadow-2xl z-[100] flex flex-col font-mono">
             <div className="flex justify-between items-center p-2 bg-gray-900 border-b border-gray-800 shrink-0">
                 <div className="flex items-center gap-2 text-green-500 px-2">
                     <Terminal size={16} />
                     <span className="text-xs font-bold">Developer Console - Raw AI Logs</span>
                 </div>
                 <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><X size={16}/></button>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs text-gray-300 bg-black/20">
                 {logs.length === 0 && <div className="text-gray-600 italic">No interaction logs yet.</div>}
                 {[...logs].reverse().map((log) => (
                     <div key={log.id} className="border border-gray-800 rounded p-0 bg-gray-900/80 shadow-sm flex flex-col">
                         <div className="flex justify-between text-gray-500 p-2 border-b border-gray-800 bg-gray-900">
                             <div className="flex items-center gap-2">
                                 <span className="font-bold text-indigo-400">{log.characterName}</span>
                                 <span className="text-[9px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                             </div>
                             <span className="text-[9px] uppercase tracking-wider">{log.id}</span>
                         </div>
                         
                         {/* Grid Container for Content */}
                         <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-800">
                             {/* Left: Prompt */}
                             <div className="flex flex-col h-80">
                                 <div className="p-2 bg-slate-900/50 text-indigo-400 font-bold text-[10px] uppercase tracking-wider flex items-center gap-2 border-b border-slate-800/50">
                                     <MessageSquare size={12}/> Prompt Context
                                 </div>
                                 <div className="flex-1 overflow-y-auto p-3 bg-black/10 custom-scrollbar">
                                     {formatPrompt(log.prompt)}
                                 </div>
                             </div>

                             {/* Right: Response */}
                             <div className="flex flex-col h-80">
                                 <div className="p-2 bg-slate-900/50 text-teal-400 font-bold text-[10px] uppercase tracking-wider border-b border-slate-800/50">
                                     Raw Response
                                 </div>
                                 <pre className="flex-1 overflow-y-auto p-3 whitespace-pre-wrap text-gray-400 font-mono text-xs bg-black/10 custom-scrollbar">
                                     {log.response}
                                 </pre>
                             </div>
                         </div>
                     </div>
                 ))}
             </div>
        </div>
    );
}
