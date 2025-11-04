import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, ChatSession, Source } from '../types';
import { generateTextWithSearchStream, generateImage, generatePresentationStream } from '../services/geminiService';
import { SendIcon, TextIcon, ImageIcon, AiIcon, PresentationIcon, ChevronDownIcon, ArrowDownCircleIcon, PkpIcon, SpinnerIcon, DownloadIcon } from './icons';

interface ChatViewProps {
  session: ChatSession;
  updateSession: (sessionId: string, updates: Partial<ChatSession>) => void;
  streamToSession: (sessionId: string, messageId: string, chunk: { text?: string; sources?: Source[] }) => void;
  updateMessageInSession: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  onStartPresentation: (htmlContent: string) => void;
}

// A simple markdown to HTML converter
const simpleMarkdownToHtml = (markdown: string): string => {
  if (!markdown) return '';
  // Avoid parsing full HTML documents
  if (markdown.trim().startsWith('<')) {
    return markdown;
  }

  let html = markdown
    // Sanitize basic HTML to prevent XSS
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Process lists items first
  html = html.replace(/^\s*[\*\-]\s(.*)/gm, '<li>$1</li>');
  // Wrap consecutive list items in <ul> tags
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>').replace(/<\/li>\s?<li>/g, '</li><li>');

  // Process bold text
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Process newlines into <br> tags
  return html.replace(/\n/g, '<br />');
};

const ChatView: React.FC<ChatViewProps> = ({ session, updateSession, streamToSession, updateMessageInSession, onStartPresentation }) => {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'text' | 'image' | 'presentation'>('text');
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isInitialView, setIsInitialView] = useState(session.messages.length === 0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsInitialView(session.messages.length === 0);
    if(session.messages.length > 0) {
       textareaRef.current?.focus();
    }
  }, [session.id, session.messages.length]);

  useEffect(() => {
    if (isAutoScrollEnabled) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [session.messages, isAutoScrollEnabled]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  const handleFirstInteraction = useCallback(() => {
    if (isInitialView) {
      setIsInitialView(false);
    }
  }, [isInitialView]);

  const handleSendMessage = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    handleFirstInteraction();
    setInput('');
    setIsLoading(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedInput,
      type: 'text',
      timestamp: new Date().toISOString(),
    };
    
    const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        type: 'text',
        timestamp: new Date().toISOString(),
        status: 'in-progress',
        mode: mode,
    };

    try {
        // Add user message and blank, in-progress assistant message
        updateSession(session.id, { messages: [...session.messages, userMessage, assistantMessage] });

        if (mode === 'image') {
            const imageUrl = await generateImage(trimmedInput);
            updateMessageInSession(session.id, assistantMessage.id, { content: imageUrl, type: 'image', status: 'complete' });
            return;
        }

        const stream = mode === 'presentation'
            ? generatePresentationStream(trimmedInput)
            : generateTextWithSearchStream(trimmedInput, session.messages
                .filter(m => m.type === 'text')
                .map(m => ({
                    role: m.role === 'user' ? 'user' : 'model' as 'user' | 'model',
                    parts: [{ text: m.content }],
                })));

        for await (const chunk of stream) {
             if (chunk.textChunk || chunk.sources) {
                streamToSession(session.id, assistantMessage.id, { text: chunk.textChunk, sources: chunk.sources });
            }
        }
    } catch (error) {
        const content = error instanceof Error ? error.message : 'Sorry, something went wrong. Please try again.';
        updateMessageInSession(session.id, assistantMessage.id, { content, type: 'error', status: 'complete' });
    } finally {
        setIsLoading(false);
        updateMessageInSession(session.id, assistantMessage.id, { status: 'complete' });
        setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const placeholderText = {
      text: 'Ask PKP.ai anything...',
      image: 'Describe an image to generate...',
      presentation: 'Enter presentation title...'
  }
  
  return (
    <div className="relative flex flex-col h-full bg-gray-900/50 overflow-hidden">
        {/* Header with Tools Dropdown */}
        <header className={`absolute top-0 right-0 p-4 z-20 transition-opacity duration-500 ${isInitialView ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <div className="relative" ref={dropdownRef}>
                <button onClick={() => setIsDropdownOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm rounded-lg bg-gray-900/50 hover:bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 transition-colors shadow-lg">
                    {mode === 'text' && <TextIcon className="w-4 h-4 text-indigo-400" />}
                    {mode === 'image' && <ImageIcon className="w-4 h-4 text-pink-400" />}
                    {mode === 'presentation' && <PresentationIcon className="w-4 h-4 text-green-400" />}
                    <span className="capitalize">{mode === 'text' ? 'Chat' : mode}</span>
                    <ChevronDownIcon className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {isDropdownOpen && (
                     <div className="absolute top-full mt-2 right-0 w-48 bg-gray-900/80 backdrop-blur-md border border-gray-700 rounded-lg shadow-2xl overflow-hidden animate-fade-in-up z-10">
                         <button onClick={() => { setMode('text'); setIsDropdownOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-indigo-500/30 transition-colors">
                             <TextIcon className="w-5 h-5 text-indigo-400" /> Chat
                         </button>
                         <button onClick={() => { setMode('image'); setIsDropdownOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-pink-500/30 transition-colors">
                             <ImageIcon className="w-5 h-5 text-pink-400" /> Image
                         </button>
                         <button onClick={() => { setMode('presentation'); setIsDropdownOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-green-500/30 transition-colors">
                             <PresentationIcon className="w-5 h-5 text-green-400" /> Presentation
                         </button>
                     </div>
                )}
            </div>
        </header>

      <div className={`flex-grow p-4 md:p-6 overflow-y-auto transition-opacity duration-500 ${isInitialView ? 'opacity-0' : 'opacity-100'}`}>
        <div className="max-w-3xl mx-auto space-y-6 pb-24">
          {session.messages.map((msg, index) => (
            <MemoizedMessageItem key={msg.id} message={msg} onPresent={onStartPresentation} isLoading={isLoading && index === session.messages.length - 1 && msg.content === '' && msg.status === 'in-progress'} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
     
      {/* Animated container for initial view text and input */}
      <div className={`
          absolute left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 md:px-0
          transition-all duration-700 ease-in-out z-10
          ${isInitialView ? 'top-1/2 -translate-y-1/2' : 'bottom-6'}
      `}>
          {/* Initial view text */}
          <div className={`text-center mb-4 transition-all duration-500 ${isInitialView ? 'opacity-100' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
               <div className="flex justify-center items-center gap-3 mb-4">
                  <div className="p-2.5 bg-indigo-600 rounded-2xl shadow-[0_0_20px_rgba(129,140,248,0.6)]">
                    <PkpIcon />
                  </div>
                  <h2 className="text-4xl font-bold tracking-tight">PKP.ai</h2>
               </div>
              <p className="text-gray-400 text-lg">How can I help you?</p>
          </div>

          {/* Input area */}
          <div className="relative p-px rounded-2xl animated-gradient-border" style={{boxShadow: '0 0 25px rgba(129, 140, 248, 0.4), 0 0 40px rgba(79, 70, 229, 0.3)'}}>
            <textarea
              ref={textareaRef}
              value={input}
              onFocus={handleFirstInteraction}
              onChange={(e) => {
                  handleFirstInteraction();
                  setInput(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText[mode]}
              className="w-full bg-gray-900 text-white rounded-2xl p-4 pr-12 resize-none focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-75"
              rows={1}
              style={{ minHeight: '52px', maxHeight: '200px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${target.scrollHeight}px`;
              }}
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !input.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all shadow-[0_0_10px_rgba(129,140,248,0.5)] hover:shadow-[0_0_15px_rgba(129,140,248,0.8)]"
            >
              {isLoading ? <SpinnerIcon className="w-5 h-5"/> : <SendIcon className="w-5 h-5" />}
            </button>
          </div>
         
          {/* "Enter to send" hint and autoscroll */}
          <div className={`mt-3 flex items-center justify-between transition-opacity duration-500 delay-300 ${isInitialView ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <button onClick={() => setIsAutoScrollEnabled(a => !a)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm rounded-lg transition-colors ${isAutoScrollEnabled ? 'bg-gray-800 text-indigo-400' : 'bg-gray-800/50 text-gray-500 hover:bg-gray-700'}`}>
                    <ArrowDownCircleIcon className="w-4 h-4" />
                    <span>Auto-Scroll</span>
                </button>
             <p className="hidden sm:block text-xs text-gray-400">Enter to send, Shift+Enter for new line.</p>
          </div>
      </div>
    </div>
  );
};


const MessageItem: React.FC<{ message: Message; onPresent: (html: string) => void, isLoading: boolean }> = ({ message, onPresent, isLoading }) => {
    const isUser = message.role === 'user';
    const isPresentationReady = (message.mode === 'presentation' || message.content.trim().toLowerCase().startsWith('<!doctype html>')) && message.status === 'complete';

    const cleanHtmlContent = (content: string) => {
        let cleanContent = content.trim();
        // Clean up potential markdown code blocks like ```html ... ```
        const match = cleanContent.match(/^```html\s*([\s\S]*?)\s*```$/);
        if (match && match[1]) {
            cleanContent = match[1];
        }
        return cleanContent;
    };

    const handlePresent = () => {
        onPresent(cleanHtmlContent(message.content));
    };

    const handleDownload = () => {
        const htmlContent = cleanHtmlContent(message.content);
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'presentation.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (isLoading && message.mode !== 'presentation') {
        return (
             <div className="flex items-start gap-4">
                <div className="w-8 h-8 flex-shrink-0 rounded-full bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(129,140,248,0.6)]">
                    <AiIcon />
                </div>
                <div className="flex items-center gap-3 pt-1.5">
                    <p className="text-gray-400 text-sm">PKP.ai is thinking</p>
                    <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-75"></span>
                    <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-150"></span>
                    <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-225"></span>
                </div>
            </div>
        )
    }

    if (message.mode === 'presentation' && message.status === 'in-progress') {
        return (
            <div className="flex items-start gap-4">
                <div className="w-8 h-8 flex-shrink-0 rounded-full bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(129,140,248,0.6)]">
                    <AiIcon />
                </div>
                <div className="p-4 rounded-lg bg-gray-800 shadow-[0_0_15px_rgba(55,65,81,0.5)] w-full max-w-[90%] md:max-w-[80%]">
                    <p className="text-white/90 mb-2 text-sm">Generating presentation...</p>
                    <div className="relative w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                        <div className="absolute top-0 left-0 h-full w-full rounded-full bg-indigo-500/50 after:content-[''] after:absolute after:top-0 after:left-0 after:h-full after:w-1/3 after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:animate-[shimmer_1.5s_infinite]"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex items-start gap-4 ${isUser ? 'justify-end' : ''}`}>
            {!isUser && (
                <div className="w-8 h-8 flex-shrink-0 rounded-full bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(129,140,248,0.6)]">
                    <AiIcon />
                </div>
            )}
            <div className={`p-4 rounded-lg max-w-[90%] md:max-w-[80%] ${isUser ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'bg-gray-800 shadow-[0_0_15px_rgba(55,65,81,0.5)]'}`}>
                {isPresentationReady ? (
                    <div>
                        <p className="text-white/90">Your presentation is ready.</p>
                        <div className="mt-4 border-t border-gray-600/50 pt-3 flex items-center gap-2">
                            <button onClick={handlePresent} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-green-600 hover:bg-green-700 transition-colors shadow-lg hover:shadow-green-500/50">
                                <PresentationIcon className="w-5 h-5" />
                                Present Slides
                            </button>
                            <button onClick={handleDownload} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-lg hover:shadow-indigo-500/50">
                                <DownloadIcon className="w-5 h-5" />
                                Download
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {message.type === 'text' && <div className="prose prose-invert max-w-none prose-p:text-white/90" dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(message.content) }} />}
                        {message.type === 'image' && <img src={message.content} alt="Generated image" className="rounded-lg max-w-full h-auto" />}
                        {message.type === 'error' && <p className="text-red-400">{message.content}</p>}
                    </>
                )}
                
                {message.sources && message.sources.length > 0 && (
                    <div className="mt-4 border-t border-gray-600/50 pt-3">
                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Sources:</h4>
                        <div className="flex flex-wrap gap-2">
                            {message.sources.map((source, index) => (
                                <a key={index} href={source.uri} target="_blank" rel="noopener noreferrer" className="text-xs bg-gray-700 text-blue-300 px-2 py-1 rounded-md hover:bg-gray-600 transition-colors truncate">
                                    {source.title || new URL(source.uri).hostname}
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const MemoizedMessageItem = React.memo(MessageItem);

export default ChatView;