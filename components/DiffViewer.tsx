import React, { useEffect, useState, useRef } from 'react';
import { diffWordsWithSpace } from 'diff';

interface DiffViewerProps {
  original: string;
  cleaned: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ original, cleaned }) => {
  const [diffs, setDiffs] = useState<any[]>([]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef<'left' | 'right' | null>(null);

  useEffect(() => {
    // Compute diff only when text changes drastically or processing stops
    // We use a small timeout to avoid blocking UI on every keystroke if typing
    const timer = setTimeout(() => {
      if (original && cleaned) {
        try {
          const calculated = diffWordsWithSpace(original, cleaned);
          setDiffs(calculated);
        } catch (e) {
          console.error("Diff calculation failed", e);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [original, cleaned]);

  const handleScroll = (source: 'left' | 'right') => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    if (isScrolling.current && isScrolling.current !== source) return;

    isScrolling.current = source;
    
    // Sync percentage of scroll to handle different content heights slightly better
    if (source === 'left') {
      const percentage = left.scrollTop / (left.scrollHeight - left.clientHeight);
      right.scrollTop = percentage * (right.scrollHeight - right.clientHeight);
    } else {
      const percentage = right.scrollTop / (right.scrollHeight - right.clientHeight);
      left.scrollTop = percentage * (left.scrollHeight - left.clientHeight);
    }

    // Reset lock after a short delay
    setTimeout(() => {
      isScrolling.current = null;
    }, 50);
  };

  return (
    <div className="grid grid-cols-2 gap-4 h-full border border-slate-200 rounded-xl overflow-hidden bg-white">
      {/* LEFT: ORIGINAL (Shows Removed) */}
      <div className="flex flex-col border-r border-slate-100">
        <div className="bg-slate-50 p-2 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider flex justify-between">
          <span>Original Input</span>
          <span className="text-red-500">Red = Removed/Changed</span>
        </div>
        <div 
          ref={leftRef}
          onScroll={() => handleScroll('left')}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm whitespace-pre-wrap leading-relaxed diff-scroll"
        >
          {diffs.map((part, index) => {
            // In Left column: Show 'removed' (red) and 'unchanged' (normal). Hide 'added'.
            if (part.added) return null;
            
            return (
              <span 
                key={index} 
                className={part.removed ? "bg-red-100 text-red-700 line-through decoration-red-400 decoration-2" : "text-slate-600"}
              >
                {part.value}
              </span>
            );
          })}
        </div>
      </div>

      {/* RIGHT: CLEANED (Shows Added) */}
      <div className="flex flex-col">
        <div className="bg-slate-50 p-2 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider flex justify-between">
          <span>Cleaned Output</span>
          <span className="text-green-600">Green = Added/Fixed</span>
        </div>
        <div 
          ref={rightRef}
          onScroll={() => handleScroll('right')}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm whitespace-pre-wrap leading-relaxed diff-scroll"
        >
          {diffs.map((part, index) => {
            // In Right column: Show 'added' (green) and 'unchanged' (normal). Hide 'removed'.
            if (part.removed) return null;

            return (
              <span 
                key={index} 
                className={part.added ? "bg-green-100 text-green-800 font-medium" : "text-slate-800"}
              >
                {part.value}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
