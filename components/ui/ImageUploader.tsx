
import React, { useState, useRef, useEffect } from 'react';
import { Button } from './Button';
import { Upload, Grid, Image as ImageIcon, Check, Pencil, Eraser, Trash2, FolderOpen, Circle, CircleDot } from 'lucide-react';
import { BUILT_IN_IMAGES, LibraryImage } from '../../assets/imageLibrary';

interface ImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  className?: string;
}

// --- Pixel Editor Component ---
const PixelEditor: React.FC<{ onSave: (dataUrl: string) => void, onClose: () => void }> = ({ onSave, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [color, setColor] = useState('#ffffff');
    const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');
    const [brushSize, setBrushSize] = useState<1 | 2 | 3>(1);
    const [grid, setGrid] = useState<string[][]>(Array(16).fill(Array(16).fill('transparent')));
    const [isDrawing, setIsDrawing] = useState(false);

    // Initialize grid state independently to avoid reference issues
    useEffect(() => {
        const newGrid = Array(16).fill(null).map(() => Array(16).fill('transparent'));
        setGrid(newGrid);
    }, []);

    const drawPixel = (cx: number, cy: number) => {
        const newGrid = grid.map(row => [...row]);
        
        // Determine range based on brush size
        // Size 1: (0,0) -> just cx,cy
        // Size 2: (0,0), (1,0), (0,1), (1,1) -> 2x2 block from top-left
        // Size 3: (-1,-1) to (1,1) -> 3x3 centered
        
        let startOffset = 0;
        let endOffset = 0;

        if (brushSize === 1) { startOffset = 0; endOffset = 0; }
        else if (brushSize === 2) { startOffset = 0; endOffset = 1; } // Draw right/down
        else if (brushSize === 3) { startOffset = -1; endOffset = 1; } // Draw centered

        for (let dy = startOffset; dy <= endOffset; dy++) {
            for (let dx = startOffset; dx <= endOffset; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                
                if (x >= 0 && x < 16 && y >= 0 && y < 16) {
                    newGrid[y][x] = tool === 'pencil' ? color : 'transparent';
                }
            }
        }
        
        setGrid(newGrid);
    };

    const handleCanvasEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const x = Math.floor((e.clientX - rect.left) * scaleX / 20); // 320 / 16 = 20px per block visual
        const y = Math.floor((e.clientY - rect.top) * scaleY / 20);
        
        drawPixel(x, y);
    };

    const exportImage = () => {
        // Create a 64x64 canvas for output
        const outCanvas = document.createElement('canvas');
        outCanvas.width = 64;
        outCanvas.height = 64;
        const ctx = outCanvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = false;
            grid.forEach((row, y) => {
                row.forEach((col, x) => {
                    if (col !== 'transparent') {
                        ctx.fillStyle = col;
                        ctx.fillRect(x * 4, y * 4, 4, 4); // Scale 16x16 -> 64x64
                    }
                });
            });
            onSave(outCanvas.toDataURL('image/png'));
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex gap-2 mb-2 p-2 bg-slate-950 rounded border border-slate-800 items-center justify-between flex-wrap">
                 <div className="flex gap-2 items-center">
                     <div className="flex bg-slate-900 rounded p-0.5 border border-slate-800">
                         <button onClick={() => setTool('pencil')} className={`p-2 rounded ${tool === 'pencil' ? 'bg-indigo-600 text-white' : 'bg-transparent text-slate-400'}`} title="铅笔"><Pencil size={16}/></button>
                         <button onClick={() => setTool('eraser')} className={`p-2 rounded ${tool === 'eraser' ? 'bg-indigo-600 text-white' : 'bg-transparent text-slate-400'}`} title="橡皮擦"><Eraser size={16}/></button>
                     </div>
                     <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-8 w-8 rounded cursor-pointer bg-transparent border-none"/>
                     
                     <div className="h-6 w-px bg-slate-800 mx-1"></div>
                     
                     <div className="flex bg-slate-900 rounded p-0.5 border border-slate-800">
                         <button onClick={() => setBrushSize(1)} className={`w-8 h-8 flex items-center justify-center rounded ${brushSize === 1 ? 'bg-slate-700 text-white' : 'text-slate-500'}`} title="1x1">
                             <div className="w-1 h-1 bg-current"></div>
                         </button>
                         <button onClick={() => setBrushSize(2)} className={`w-8 h-8 flex items-center justify-center rounded ${brushSize === 2 ? 'bg-slate-700 text-white' : 'text-slate-500'}`} title="2x2">
                             <div className="w-2 h-2 bg-current"></div>
                         </button>
                         <button onClick={() => setBrushSize(3)} className={`w-8 h-8 flex items-center justify-center rounded ${brushSize === 3 ? 'bg-slate-700 text-white' : 'text-slate-500'}`} title="3x3">
                             <div className="w-3 h-3 bg-current"></div>
                         </button>
                     </div>
                 </div>
                 <button onClick={() => setGrid(Array(16).fill(null).map(() => Array(16).fill('transparent')))} className="text-red-400 hover:bg-red-900/30 p-2 rounded"><Trash2 size={16}/></button>
            </div>
            
            <div className="flex-1 flex items-center justify-center bg-slate-800/50 rounded border border-slate-700 relative overflow-hidden select-none">
                {/* Grid Background */}
                <div 
                    className="grid grid-cols-16 w-[320px] h-[320px] border border-slate-600" 
                    style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(16, 1fr)',
                        gridTemplateRows: 'repeat(16, 1fr)',
                        backgroundImage: 'linear-gradient(45deg, #1e293b 25%, transparent 25%), linear-gradient(-45deg, #1e293b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e293b 75%), linear-gradient(-45deg, transparent 75%, #1e293b 75%)',
                        backgroundSize: '20px 20px',
                        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                    }}
                >
                    {grid.map((row, y) => row.map((cellColor, x) => (
                        <div 
                            key={`${x}-${y}`} 
                            style={{ backgroundColor: cellColor }} 
                            className="border-[0.5px] border-slate-700/20 pointer-events-none"
                        />
                    )))}
                </div>
                
                {/* Interaction Layer */}
                <canvas 
                    ref={canvasRef}
                    width={320}
                    height={320}
                    className="absolute w-[320px] h-[320px] cursor-crosshair opacity-0"
                    onMouseDown={() => setIsDrawing(true)}
                    onMouseUp={() => setIsDrawing(false)}
                    onMouseLeave={() => setIsDrawing(false)}
                    onMouseMove={(e) => isDrawing && handleCanvasEvent(e)}
                    onClick={handleCanvasEvent}
                />
            </div>
            
            <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>取消</Button>
                <Button onClick={exportImage}>保存图标</Button>
            </div>
        </div>
    );
};


export const ImageUploader: React.FC<ImageUploaderProps> = ({ value, onChange, className }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [mode, setMode] = useState<'library' | 'draw'>('library');
  const [selectedLibImg, setSelectedLibImg] = useState<LibraryImage | null>(null);

  // Simple in-memory session storage for user created icons
  const [userIcons, setUserIcons] = useState<LibraryImage[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const confirmLibrarySelection = () => {
      if (selectedLibImg) {
          onChange(selectedLibImg.url);
          setShowLibrary(false);
      }
  };
  
  const handleSaveDrawing = (dataUrl: string) => {
      const newIcon: LibraryImage = {
          id: `user_${Date.now()}`,
          category: 'icon',
          label: 'User Icon',
          url: dataUrl
      };
      setUserIcons(prev => [...prev, newIcon]);
      onChange(dataUrl);
      setShowLibrary(false);
      setMode('library');
  };

  return (
    <div className={`relative flex gap-4 items-center ${className}`}>
      
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*"
        onChange={handleFileChange}
      />
      
      {/* Preview Area - Acts as main visual anchor */}
      <div 
        className="w-16 h-16 shrink-0 bg-slate-900 rounded-lg overflow-hidden border-2 border-slate-700 group relative cursor-pointer hover:border-indigo-500 transition-colors"
        onClick={() => setShowLibrary(true)}
        title="点击打开图标库 / 编辑"
      >
        {value ? (
             <img src={value} className="w-full h-full object-cover pixelated" style={{ imageRendering: 'pixelated' }} alt="Preview" />
        ) : (
             <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-950">
                 <ImageIcon size={24}/>
             </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-opacity">
            更换
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
          <Button 
            type="button" 
            variant="secondary" 
            size="sm"
            onClick={() => { setShowLibrary(true); setMode('library'); }}
            title="Open Built-in Library"
            className="flex items-center gap-2 w-32 justify-start"
          >
            <Grid size={14} /> 打开图库
          </Button>

          <Button 
            type="button" 
            variant="secondary" 
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            title="Upload Local Image"
            className="flex items-center gap-2 w-32 justify-start"
          >
            <Upload size={14} /> 上传文件
          </Button>
      </div>

      {/* Library Modal */}
      {showLibrary && (
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-2xl max-h-[90vh] h-[600px] flex flex-col shadow-2xl">
                  <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-lg shrink-0">
                      <div className="flex gap-4 overflow-hidden">
                          <h3 className="font-bold text-white flex items-center gap-2 shrink-0"><ImageIcon size={18}/> 图标库 (Icon Library)</h3>
                          <div className="flex bg-slate-800 rounded p-0.5 border border-slate-700 shrink-0">
                              <button onClick={() => setMode('library')} className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 ${mode === 'library' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><FolderOpen size={12}/> 浏览</button>
                              <button onClick={() => setMode('draw')} className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 ${mode === 'draw' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Pencil size={12}/> 绘制</button>
                          </div>
                      </div>
                      <button onClick={() => setShowLibrary(false)} className="text-slate-400 hover:text-white shrink-0"><Check size={20}/></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 bg-slate-900">
                      {mode === 'library' ? (
                          <div className="space-y-8">
                              {/* User Icons "Folder" */}
                              <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                                  <h4 className="text-xs font-bold text-indigo-400 uppercase mb-4 flex items-center gap-2"><FolderOpen size={14}/> 用户创建 (User Created)</h4>
                                  {userIcons.length === 0 ? (
                                      <div className="text-xs text-slate-600 italic p-4 text-center border border-dashed border-slate-800 rounded">暂无自制图标。请使用“绘制”功能创建。</div>
                                  ) : (
                                      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-4">
                                          {userIcons.map(img => (
                                              <div 
                                                key={img.id} 
                                                onClick={() => setSelectedLibImg(img)}
                                                className={`
                                                    relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group bg-black
                                                    ${selectedLibImg?.id === img.id ? 'border-indigo-500 ring-2 ring-indigo-500/50 shadow-lg scale-105' : 'border-slate-800 hover:border-slate-500'}
                                                `}
                                              >
                                                  <img src={img.url} className="w-full h-full object-cover pixelated" style={{ imageRendering: 'pixelated' }} alt={img.label}/>
                                                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-center text-white py-0.5 truncate px-1">{img.label}</div>
                                              </div>
                                          ))}
                                      </div>
                                  )}
                              </div>

                              {/* Default Icons "Folder" */}
                              <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-4 flex items-center gap-2"><FolderOpen size={14}/> 系统默认 (Built-in)</h4>
                                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-4">
                                      {BUILT_IN_IMAGES.map(img => (
                                          <div 
                                            key={img.id} 
                                            onClick={() => setSelectedLibImg(img)}
                                            className={`
                                                relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group bg-black
                                                ${selectedLibImg?.id === img.id ? 'border-indigo-500 ring-2 ring-indigo-500/50 shadow-lg scale-105' : 'border-slate-800 hover:border-slate-500'}
                                            `}
                                          >
                                              <img src={img.url} className="w-full h-full object-cover pixelated" style={{ imageRendering: 'pixelated' }} alt={img.label}/>
                                              <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-center text-white py-0.5 truncate px-1">{img.label}</div>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      ) : (
                          <div className="h-full flex items-center justify-center">
                              <PixelEditor onSave={handleSaveDrawing} onClose={() => setMode('library')} />
                          </div>
                      )}
                  </div>
                  
                  {mode === 'library' && (
                      <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-between items-center rounded-b-lg shrink-0">
                          <div className="text-xs text-slate-500">
                              {selectedLibImg ? `已选: ${selectedLibImg.label}` : '请选择图片'}
                          </div>
                          <div className="flex gap-2">
                              <Button variant="secondary" onClick={() => setShowLibrary(false)}>取消</Button>
                              <Button onClick={confirmLibrarySelection} disabled={!selectedLibImg}>确认使用</Button>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
};
