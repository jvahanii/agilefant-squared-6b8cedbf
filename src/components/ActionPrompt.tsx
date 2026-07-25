import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface PromptOption {
  label: string;
  description: string;
  value: string;
  isDefault?: boolean;
  variant?: 'default' | 'destructive';
}

interface ActionPromptProps {
  title: string;
  options: PromptOption[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function ActionPrompt({ title, options, onSelect, onCancel }: ActionPromptProps) {
  const [selected, setSelected] = useState(() => options.findIndex(o => o.isDefault) ?? 0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSelect(options[selected].value);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(s => {
          const next = e.key === 'ArrowDown' ? s + 1 : s - 1;
          return Math.max(0, Math.min(options.length - 1, next));
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, onSelect, options, selected]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]" onClick={onCancel} />
      <div
        ref={dialogRef}
        className="relative bg-card border rounded-lg shadow-2xl w-full max-w-sm mx-4 animate-fade-in-up overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
            onClick={onCancel}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="px-2 pb-2">
          {options.map((opt, i) => (
            <button
              key={opt.value}
              className={`
                w-full text-left px-3 py-2.5 rounded-md transition-all duration-100 ease-out
                ${i === selected
                  ? opt.variant === 'destructive'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted text-foreground'}
              `}
              onClick={() => onSelect(opt.value)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
        <div className="px-4 pb-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span><kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">Enter</kbd> confirm</span>
          <span><kbd className="px-1 py-0.5 rounded border bg-muted text-[10px]">Esc</kbd> cancel</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
