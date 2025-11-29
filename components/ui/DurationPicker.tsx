
import React, { useRef, useEffect, useState } from 'react';
import { Button } from './Button';
import { Check, X } from 'lucide-react';

interface DurationPickerProps {
    initialDuration: { y: number, m: number, d: number, h: number, min: number, s: number };
    onConfirm: (duration: { y: number, m: number, d: number, h: number, min: number, s: number }) => void;
    onCancel: () => void;
}

const ScrollColumn: React.FC<{
    label: string;
    range: number;
    value: number;
    onChange: (val: number) => void;
}> = ({ label, range, value, onChange }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const itemHeight = 40; // Height of each item in pixels

    // Generate array 0 to range-1
    const items = Array.from({ length: range }, (_, i) => i);

    // Handle Scroll to update value
    const handleScroll = () => {
        if (scrollRef.current) {
            const scrollTop = scrollRef.current.scrollTop;
            const selectedIndex = Math.round(scrollTop / itemHeight);
            if (selectedIndex !== value) {
                // Clamp to valid range
                const clamped = Math.max(0, Math.min(range - 1, selectedIndex));
                if (clamped !== value) onChange(clamped);
            }
        }
    };

    // Initial scroll position
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = value * itemHeight;
        }
    }, []); // Run once on mount

    return (
        <div className="flex flex-col items-center w-14">
            <span className="text-[10px] text-slate-500 uppercase font-bold mb-1">{label}</span>
            <div className="relative h-40 w-full bg-slate-900/50 border-y border-slate-700 overflow-hidden">
                {/* Highlight Overlay */}
                <div className="absolute top-[40px] left-0 right-0 h-[40px] bg-indigo-500/20 border-y border-indigo-500/50 pointer-events-none z-10"></div>
                
                <div 
                    ref={scrollRef}
                    className="h-full overflow-y-scroll scrollbar-hide snap-y snap-mandatory"
                    onScroll={handleScroll}
                    style={{ paddingTop: '40px', paddingBottom: '40px' }} // Pad to center first/last
                >
                    {items.map(i => (
                        <div 
                            key={i} 
                            className={`h-[40px] flex items-center justify-center snap-center text-sm font-mono transition-colors ${i === value ? 'text-white font-bold scale-110' : 'text-slate-600'}`}
                        >
                            {i}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const DurationPicker: React.FC<DurationPickerProps> = ({ initialDuration, onConfirm, onCancel }) => {
    const [val, setVal] = useState(initialDuration);

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-950 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden transform transition-all scale-100">
                <div className="p-3 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
                    <h3 className="font-bold text-white text-sm">设定本轮流逝时间</h3>
                    <button onClick={onCancel} className="text-slate-500 hover:text-white"><X size={18}/></button>
                </div>
                
                <div className="p-6 flex justify-center gap-1 bg-black/40">
                    <ScrollColumn label="年" range={100} value={val.y} onChange={v => setVal({...val, y: v})} />
                    <ScrollColumn label="月" range={12} value={val.m} onChange={v => setVal({...val, m: v})} />
                    <ScrollColumn label="日" range={31} value={val.d} onChange={v => setVal({...val, d: v})} />
                    <div className="w-px bg-slate-800 mx-1 h-32 self-center"></div>
                    <ScrollColumn label="时" range={24} value={val.h} onChange={v => setVal({...val, h: v})} />
                    <ScrollColumn label="分" range={60} value={val.min} onChange={v => setVal({...val, min: v})} />
                    <ScrollColumn label="秒" range={60} value={val.s} onChange={v => setVal({...val, s: v})} />
                </div>

                <div className="p-3 border-t border-slate-800 bg-slate-900 flex justify-end gap-2">
                    <Button variant="secondary" onClick={onCancel} size="sm">取消</Button>
                    <Button onClick={() => onConfirm(val)} size="sm" className="bg-indigo-600 hover:bg-indigo-500">
                        <Check size={14} className="mr-1"/> 确认
                    </Button>
                </div>
            </div>
        </div>
    );
};
