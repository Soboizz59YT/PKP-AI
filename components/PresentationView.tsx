
import React from 'react';
import { CloseIcon } from './icons';

interface PresentationViewProps {
  htmlContent: string;
  onExit: () => void;
}

const PresentationView: React.FC<PresentationViewProps> = ({ htmlContent, onExit }) => {
  return (
    <div className="fixed inset-0 bg-black flex flex-col text-white z-[60]">
      <iframe
        key={htmlContent.length} // Force re-render if content length changes significantly to prevent stale state
        srcDoc={htmlContent}
        title="Presentation"
        className="w-full h-full border-0"
        scrolling="no"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
      <div className="absolute top-4 right-4">
        <button onClick={onExit} className="p-2 rounded-full bg-black/50 hover:bg-black/80 transition-colors">
          <CloseIcon className="w-6 h-6" />
        </button>
      </div>
      <div className="absolute bottom-4 left-4 text-white/50 text-lg font-semibold pointer-events-none" style={{ textShadow: '0 0 8px rgba(0, 0, 0, 0.7)' }}>
        pkp.ai
      </div>
    </div>
  );
};

export default PresentationView;
