
import React, { forwardRef, useRef, useState, useEffect } from 'react';
import { Grip } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-primary text-primary-fg hover:bg-primary-hover focus:ring-primary border border-transparent",
    secondary: "bg-secondary text-secondary-fg hover:bg-secondary-hover focus:ring-border border border-border",
    danger: "bg-danger text-danger-fg hover:bg-danger-hover focus:ring-danger border border-transparent",
    ghost: "bg-transparent text-muted hover:text-highlight hover:bg-surface-highlight",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    className={`flex h-10 w-full rounded-md border border-border bg-surface-light px-3 py-2 text-sm text-highlight placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${props.className || ''}`}
    // Remove inline styles as CSS variables now handle this in :root
    {...props}
  />
);

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Use internal ref if external is not provided, or merge them (simplification: simple usage here)
    const innerRef = useRef<HTMLTextAreaElement>(null);
    
    // Merge refs logic
    useEffect(() => {
        if (!ref) return;
        if (typeof ref === 'function') {
            ref(innerRef.current);
        } else {
            (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = innerRef.current;
        }
    }, [ref]);

    const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
        // Essential: Prevent default behavior (scroll, text selection) immediately
        // This allows the script to claim the gesture on touch devices.
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        
        const container = containerRef.current;
        if (!container) return;

        const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const startHeight = container.offsetHeight;

        const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
            // Prevent scrolling while dragging
            if (moveEvent.cancelable) moveEvent.preventDefault();
            
            const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;
            const newHeight = startHeight + (currentY - startY);

            // Apply size to the CONTAINER, which controls the textarea size
            container.style.height = `${Math.max(40, newHeight)}px`;
        };

        const handleUp = () => {
            // Remove listeners. Note: use capture: true to match addition
            window.removeEventListener('mousemove', handleMove, { capture: true });
            window.removeEventListener('mouseup', handleUp, { capture: true });
            window.removeEventListener('touchmove', handleMove, { capture: true });
            window.removeEventListener('touchend', handleUp, { capture: true });
        };

        // Add listeners to window with capture: true
        // This ensures we receive events even if a parent (like a Modal) stops propagation in the bubbling phase.
        window.addEventListener('mousemove', handleMove, { capture: true });
        window.addEventListener('mouseup', handleUp, { capture: true });
        window.addEventListener('touchmove', handleMove, { capture: true, passive: false });
        window.addEventListener('touchend', handleUp, { capture: true });
    };

    // Extract layout-related styles to wrapper vs input styles
    // In this "Smart" implementation, we move the border/background/focus styling to the Wrapper
    // and make the Textarea transparent and fill the space.
    // This allows the Resize Handle to sit inside the visual box.

    return (
        <div 
            ref={containerRef}
            className={`
                relative group flex flex-col 
                rounded-md border border-border bg-surface-light 
                focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent
                transition-colors
                ${props.className || 'w-full'} 
            `}
            // Ensure container doesn't collapse if className overrides w-full
            style={{ minHeight: '40px' }} 
        >
            <textarea
                ref={innerRef}
                {...props}
                className={`
                    w-full h-full bg-transparent border-none outline-none resize-none 
                    px-3 py-2 text-sm text-highlight placeholder:text-faint 
                    disabled:cursor-not-allowed disabled:opacity-50
                    scrollbar-thin scrollbar-thumb-primary/20
                `}
                // Clean props.className from here to avoid duplication/conflict, logic handled by wrapper
                style={{ ...props.style, resize: 'none' }}
            />
            
            {/* Custom Resize Grip */}
            <div 
                className="absolute bottom-0 right-0 p-2 cursor-ns-resize touch-none z-10 opacity-50 group-hover:opacity-100 transition-opacity"
                onMouseDown={handleResizeStart}
                onTouchStart={handleResizeStart}
                title="Drag to resize height"
            >
                {/* 
                    Hit area is padding (p-2 = 8px + icon size), roughly 32x32px. 
                    Visual icon is small, hit box is usable. 
                */}
                <Grip size={16} className="text-muted/70" />
            </div>
        </div>
    );
});
TextArea.displayName = "TextArea";

export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>> = ({ children, className, ...props }) => (
  <label className={`text-xs font-medium text-muted mb-1 block ${className}`} {...props}>
    {children}
  </label>
);
