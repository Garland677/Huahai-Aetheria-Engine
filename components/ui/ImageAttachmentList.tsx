
import React from 'react';
import { GameImage } from '../../types';
import { X, Plus, Image as ImageIcon } from 'lucide-react';

interface ImageAttachmentListProps {
    images: GameImage[];
    onRemove: (id: string) => void;
    onAdd: () => void;
    maxImages: number;
    label?: string;
    readOnly?: boolean;
    onImageClick?: (image: GameImage) => void;
    compact?: boolean; // New prop for tight layouts
}

export const ImageAttachmentList: React.FC<ImageAttachmentListProps> = ({ 
    images, onRemove, onAdd, maxImages, label = "图片附件", readOnly = false, onImageClick, compact = false
}) => {
    return (
        <div className="space-y-2">
            {!compact && (
                <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-muted uppercase flex items-center gap-2">
                        <ImageIcon size={12}/> {label} ({images.length}/{maxImages})
                    </span>
                    {!readOnly && images.length < maxImages && (
                        <button 
                            onClick={onAdd}
                            className="text-[10px] bg-primary/20 hover:bg-primary/30 text-primary px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
                        >
                            <Plus size={10}/> 添加图片
                        </button>
                    )}
                </div>
            )}
            
            {images.length > 0 ? (
                <div className={`flex gap-2 overflow-x-auto custom-scrollbar items-start ${compact ? 'pb-1 min-h-[50px]' : 'pb-2 min-h-[60px]'}`}>
                    {images.map(img => (
                        <div 
                            key={img.id} 
                            className={`
                                relative group shrink-0 border border-border rounded-lg bg-black/20 flex flex-col overflow-hidden cursor-pointer hover:border-primary transition-colors shadow-sm
                                ${compact ? 'w-16 h-16' : 'w-32'}
                            `}
                            onClick={() => onImageClick && onImageClick(img)}
                        >
                            {/* Image Container */}
                            <div className={`w-full relative bg-black/50 flex items-center justify-center ${compact ? 'h-full' : ''}`}>
                                <img 
                                    src={img.base64} 
                                    alt={img.description} 
                                    className={`w-full h-full ${compact ? 'object-cover' : 'object-contain max-h-48'}`} 
                                />
                            </div>
                            
                            {!readOnly && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onRemove(img.id); }}
                                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:scale-110"
                                    title="删除"
                                >
                                    <X size={10}/>
                                </button>
                            )}
                            
                            {!compact && (
                                <div className="bg-surface-light/90 border-t border-border p-1.5 min-h-[1.5rem] flex items-center justify-center">
                                    <div className="text-[10px] text-muted text-center leading-tight line-clamp-2 w-full break-words">
                                        {img.description || "无描述"}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {compact && !readOnly && images.length < maxImages && (
                        <button 
                            onClick={onAdd}
                            className="shrink-0 w-8 h-16 bg-surface-highlight border border-dashed border-border rounded-lg flex items-center justify-center text-muted hover:text-primary hover:border-primary transition-colors"
                            title="添加图片"
                        >
                            <Plus size={16}/>
                        </button>
                    )}
                </div>
            ) : (
                !compact && (
                    <div className="text-[10px] text-faint italic bg-surface-highlight/30 p-2 rounded text-center border border-dashed border-border/50">
                        无图片
                    </div>
                )
            )}
        </div>
    );
};
