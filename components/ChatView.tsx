
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, ChatSession, Source } from '../types';
import { generateTextWithSearchStream, generateImage, generatePresentationStream } from '../services/geminiService';
import { SendIcon, TextIcon, ImageIcon, AiIcon, PresentationIcon, ChevronDownIcon, ArrowDownCircleIcon, PkpIcon, SpinnerIcon, DownloadIcon, PaperclipIcon, XCircleIcon, CloseIcon, EditIcon } from './icons';
import PresentationView from './PresentationView';

interface ChatViewProps {
  session: ChatSession;
  updateSession: (sessionId: string, updates: Partial<ChatSession>) => void;
  streamToSession: (sessionId: string, messageId: string, chunk: { text?: string; sources?: Source[] }) => void;
  updateMessageInSession: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  onCancelGeneration: (sessionId: string) => void;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type Content = { role: 'user' | 'model'; parts: Part[] };

// Robust HTML extractor: Finds HTML document even if surrounded by text or markdown
const cleanHtmlContent = (content: string): string => {
  if (!content) return "";
  
  // Find start: <!doctype html> or <html, case insensitive
  // We look for the tag start.
  const startMatch = content.match(/<!doctype\s+html>|<html/i);
  if (!startMatch || startMatch.index === undefined) return "";
  
  // Start substring from the tag
  let html = content.substring(startMatch.index);
  
  // Find end: </html>
  const endMatch = html.match(/<\/html>/i);
  if (endMatch && endMatch.index !== undefined) {
      // Cut off everything after </html>
      html = html.substring(0, endMatch.index + 7);
  } else {
      // If incomplete (streaming), just strip trailing markdown ticks or text
      html = html.replace(/```(html)?\s*$/i, '');
  }
  
  return html.trim();
};

// Helper to clean history. 
// CRITICAL: We MUST preserve the HTML of the presentation we are editing, otherwise the AI hallucinates.
const sanitizeHistoryContent = (content: string, preserveFullHtml: boolean = false): string => {
  if (!content) return "";
  
  // 1. Remove base64 images to save tokens
  let clean = content.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[^"'\s)]+/g, "[Base64 Image Data Removed]");
  
  // 2. If NOT preserving this specific message's HTML, replace large HTML blocks with a placeholder
  if (!preserveFullHtml) {
      // Use the same regex logic as cleanHtmlContent to identify the block
      const startMatch = clean.match(/<!doctype\s+html>|<html/i);
      
      if (startMatch && startMatch.index !== undefined) {
          const before = clean.substring(0, startMatch.index);
          // We assume the endMatch is after startMatch in valid HTML
          const afterIndex = clean.toLowerCase().lastIndexOf('</html>') + 7;
          
          if (afterIndex > startMatch.index) {
             const after = clean.substring(afterIndex);
             clean = before + "\n\n[Presentation HTML Code Omitted to Save Context]\n\n" + after;
          }
      }
  }
  return clean;
};

// A simple markdown to HTML converter for chat bubbles
const simpleMarkdownToHtml = (markdown: string): string => {
  if (!markdown) return '';
  // If it's a presentation, hide the raw code in the text bubble
  if (cleanHtmlContent(markdown).length > 20) {
    return "<em>(Presentation generated. Click 'Present' to view.)</em>"; 
  }

  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  html = html.replace(/^\s*[\*\-]\s(.*)/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>').replace(/<\/li>\s?<li>/g, '</li><li>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return html.replace(/\n/g, '<br />');
};

const ChatView: React.FC<ChatViewProps> = ({ session, updateSession, streamToSession, updateMessageInSession, onCancelGeneration }) => {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'text' | 'image' | 'presentation'>('text');
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isInitialView, setIsInitialView] = useState(session.messages.length === 0);
  const [attachment, setAttachment] = useState<{ data: string; mimeType: string; name: string } | null>(null);
  const [presentationHtml, setPresentationHtml] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setIsInitialView(session.messages.length === 0);
    if(session.messages.length > 0 && !isLoading) {
       textareaRef.current?.focus();
    }
  }, [session.id, session.messages.length, isLoading]);

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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const [, data] = result.split(',');
        const mimeType = result.match(/:(.*?);/)?.[1] ?? file.type;
        setAttachment({ data, mimeType, name: file.name });
      };
      reader.readAsDataURL(file);
    }
    if(event.target) event.target.value = '';
  };

  const handleCancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    setIsLoading(false);
    onCancelGeneration(session.id);
  }, [session.id, onCancelGeneration]);

  const handleSendMessage = async (customInput?: string, customMode?: 'text' | 'image' | 'presentation') => {
    const textToSend = customInput ?? input;
    const trimmedInput = textToSend.trim();

    if ((!trimmedInput && !attachment) || isLoading) return;

    // Detect Presentation Intent
    let modeToUse = customMode ?? mode;
    const lowerInput = trimmedInput.toLowerCase();
    
    const presentationKeywords = ['presentation', 'slide', 'deck', 'ppt', 'powerpoint'];
    
    // Only switch to presentation mode automatically if STRONG keywords are present.
    // We removed the "edit" keywords check here to allow natural return to Text mode.
    if (modeToUse === 'text') {
        if (presentationKeywords.some(kw => lowerInput.includes(kw))) {
            modeToUse = 'presentation';
        } 
    }

    handleFirstInteraction();
    if (!customInput) setInput('');

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmedInput,
      type: 'text',
      timestamp: new Date().toISOString(),
      attachment: attachment ? { data: attachment.data, mimeType: attachment.mimeType } : undefined,
      mode: modeToUse 
    };

    setAttachment(null);
    setIsLoading(true);
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        type: 'text',
        timestamp: new Date().toISOString(),
        status: 'in-progress',
        mode: modeToUse,
    };

    try {
        const updatedMessages = [...session.messages, userMessage, assistantMessage];
        updateSession(session.id, { messages: updatedMessages });

        if (modeToUse === 'image') {
            const imageUrl = await generateImage(trimmedInput, userMessage.attachment);
            if (controller.signal.aborted) return;
            updateMessageInSession(session.id, assistantMessage.id, { content: imageUrl, type: 'image', status: 'complete' });
            return;
        }

        // FIND THE LAST PRESENTATION TO PRESERVE FOR EDITING
        // We do this so the AI has the context to "edit the slide" even if we are in 'text' mode.
        let lastPresentationId: string | null = null;
        for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            if (msg.role === 'assistant' && cleanHtmlContent(msg.content).length > 20) {
                lastPresentationId = msg.id;
                break;
            }
        }

        // Token Optimization: Keep last 15 messages
        let messagesToProcess = session.messages;
        if (messagesToProcess.length > 15) {
            messagesToProcess = messagesToProcess.slice(messagesToProcess.length - 15);
        }

        const history: Content[] = messagesToProcess.map((m, index) => {
              const parts: Part[] = [];
              
              if (m.attachment) {
                  if (messagesToProcess.length - index < 3) { 
                       parts.push({ inlineData: { mimeType: m.attachment.mimeType, data: m.attachment.data } });
                  } else {
                       parts.push({ text: "[Image attachment removed to save context]" });
                  }
              }

              if (m.content) {
                  // CRITICAL FIX: Always preserve the LAST presentation, regardless of current mode.
                  // This ensures that even if we slipped into 'text' mode, the AI knows the presentation content to "edit".
                  const shouldPreserve = (m.id === lastPresentationId);
                  const cleanText = sanitizeHistoryContent(m.content, shouldPreserve);
                  parts.push({ text: cleanText });
              }
              return {
                  role: m.role === 'user' ? 'user' : 'model' as 'user' | 'model',
                  parts: parts,
              };
          })
          .filter(h => h.parts.length > 0);

        const stream = modeToUse === 'presentation'
            ? generatePresentationStream(trimmedInput, history)
            : generateTextWithSearchStream(trimmedInput, history, userMessage.attachment);

        for await (const chunk of stream) {
            if (controller.signal.aborted) break;
             if (chunk.textChunk || chunk.sources) {
                streamToSession(session.id, assistantMessage.id, { text: chunk.textChunk, sources: chunk.sources });
            }
        }
    } catch (error) {
        if (!controller.signal.aborted) {
            const content = error instanceof Error ? error.message : 'Sorry, something went wrong. Please try again.';
            updateMessageInSession(session.id, assistantMessage.id, { content, type: 'error', status: 'complete' });
        }
    } finally {
        setIsLoading(false);
        if (!controller.signal.aborted) {
            updateMessageInSession(session.id, assistantMessage.id, { status: 'complete' });
        }
        abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const placeholderText = {
      text: 'Ask PKP.ai anything, or upload an image...',
      image: 'Describe an image to generate or edit...',
      presentation: 'Enter presentation topic to generate slides...'
  }
  
  return (
    <div className="relative flex flex-col h-full bg-gray-900/50 overflow-hidden">
        {/* Presentation Overlay */}
        {presentationHtml && (
            <PresentationView 
                htmlContent={presentationHtml} 
                onExit={() => setPresentationHtml(null)} 
            />
        )}

        {/* Header */}
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
          {session.messages.map((msg) => (
            <MessageItem 
                key={msg.id} 
                message={msg} 
                isLoading={msg.status === 'in-progress'} 
                onPresent={setPresentationHtml}
                onSendEdit={(editPrompt) => handleSendMessage(editPrompt, 'presentation')}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
     
      {/* Initial View & Input Area */}
      <div className={`
          absolute left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 md:px-0
          transition-all duration-700 ease-in-out z-10
          ${isInitialView ? 'top-1/2 -translate-y-1/2' : 'bottom-6'}
      `}>
          <div className={`text-center mb-4 transition-all duration-500 ${isInitialView ? 'opacity-100' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
               <div className="flex justify-center items-center gap-3 mb-4">
                  <div className="p-2.5 bg-indigo-600 rounded-2xl shadow-[0_0_20px_rgba(129,140,248,0.6)]">
                    <PkpIcon />
                  </div>
                  <h2 className="text-4xl font-bold tracking-tight">PKP.ai</h2>
               </div>
              <p className="text-gray-400 text-lg">How can I help you?</p>
          </div>
          
          {attachment && (
              <div className="mb-2 p-2 bg-gray-800/80 backdrop-blur-sm rounded-lg flex items-center justify-between animate-fade-in-up">
                  <div className="flex items-center gap-2 overflow-hidden">
                      <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="Attachment preview" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                      <span className="text-sm text-gray-300 truncate">{attachment.name}</span>
                  </div>
                  <button onClick={() => setAttachment(null)} className="p-1 text-gray-400 hover:text-white rounded-full">
                      <XCircleIcon className="w-5 h-5" />
                  </button>
              </div>
          )}

          <div className="relative p-px rounded-2xl animated-gradient-border" style={{boxShadow: '0 0 25px rgba(129, 140, 248, 0.4), 0 0 40px rgba(79, 70, 229, 0.3)'}}>
            <div className="relative flex items-center bg-gray-900 rounded-2xl">
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="p-2 m-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-gray-700/50" aria-label="Attach file">
                <PaperclipIcon className="w-5 h-5" />
              </button>
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
                className="w-full bg-transparent text-white rounded-2xl p-2 pr-12 resize-none focus:outline-none disabled:opacity-75"
                rows={1}
                style={{ minHeight: '52px', maxHeight: '200px', boxSizing: 'border-box' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${target.scrollHeight}px`;
                }}
                disabled={isLoading}
              />
              <button
                onClick={() => isLoading ? handleCancelGeneration : handleSendMessage()}
                disabled={!isLoading && (!input.trim() && !attachment)}
                className="group absolute right-3 top-1/2 -translate-y-1/2 p-2 w-9 h-9 flex items-center justify-center rounded-full text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all shadow-[0_0_10px_rgba(129,140,248,0.5)] hover:shadow-[0_0_15px_rgba(129,140,248,0.8)]"
              >
                {isLoading ? (
                  <div className="relative w-5 h-5">
                    <SpinnerIcon className="w-5 h-5 absolute transition-opacity duration-200 group-hover:opacity-0" />
                    <XCircleIcon className="w-5 h-5 absolute transition-opacity duration-200 opacity-0 group-hover:opacity-100" />
                  </div>
                ) : (
                  <SendIcon className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
         
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


const MessageItem: React.FC<{ message: Message; isLoading: boolean; onPresent: (html: string) => void; onSendEdit: (prompt: string) => void }> = ({ message, isLoading, onPresent, onSendEdit }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editInput, setEditInput] = useState("");
    const isUser = message.role === 'user';
    
    // Robust detection using the updated cleaner function
    const htmlContent = cleanHtmlContent(message.content);
    // Determine if we have HTML to show presentation UI. 
    // We use a safe threshold (e.g. 50 chars) to ensure it's not just a fragment.
    const hasHtml = htmlContent.length > 50;
    
    const handlePresent = () => {
        if (htmlContent) onPresent(htmlContent);
    };

    const handleDownload = () => {
        if (!htmlContent) return;
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `presentation-${message.id}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleEditSubmit = () => {
        if (!editInput.trim()) return;
        setIsEditing(false);
        onSendEdit("Edit previous presentation: " + editInput);
        setEditInput("");
    };

    // If still loading and we don't have HTML yet, show a loader for presentation mode
    if (isLoading && !isUser && !hasHtml && message.mode === 'presentation') {
        return (
            <div className="flex items-start gap-4">
                <div className="w-8 h-8 flex-shrink-0 rounded-full bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(129,140,248,0.6)]">
                    <AiIcon />
                </div>
                <div className="p-4 rounded-lg bg-gray-800 shadow-[0_0_15px_rgba(55,65,81,0.5)] w-full max-w-[90%] md:max-w-[80%]">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                             <SpinnerIcon className="w-4 h-4 text-indigo-400" />
                             <span className="text-white/80 text-sm font-medium">Generating slides...</span>
                        </div>
                        <div className="space-y-2">
                            <div className="h-2 w-3/4 bg-gray-700 rounded animate-pulse"></div>
                            <div className="h-2 w-1/2 bg-gray-700 rounded animate-pulse"></div>
                        </div>
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
            <div className={`p-4 rounded-lg max-w-[90%] md:max-w-[80%] ${isUser ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.5)] text-white' : 'bg-gray-800 shadow-[0_0_15px_rgba(55,65,81,0.5)]'}`}>
                
                {hasHtml ? (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <PresentationIcon className="w-5 h-5 text-green-400" />
                            <h3 className="text-lg font-semibold text-white">Presentation Ready</h3>
                        </div>
                        <p className="text-gray-300 text-sm mb-4">
                           {isLoading ? "Finalizing slides..." : "Presentation created. You can view, download, or edit it below."}
                        </p>
                        
                        <div className="flex flex-wrap items-center gap-2 relative z-10">
                            <button 
                                onClick={handlePresent} 
                                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all shadow-lg bg-green-600 hover:bg-green-700 hover:shadow-green-500/50 text-white cursor-pointer`}
                            >
                                <PresentationIcon className="w-4 h-4" />
                                Present
                            </button>
                            <button 
                                onClick={handleDownload} 
                                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all shadow-lg bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/50 text-white cursor-pointer`}
                            >
                                <DownloadIcon className="w-4 h-4" />
                                Download
                            </button>
                             <button 
                                onClick={() => setIsEditing(!isEditing)} 
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-all shadow-lg border border-gray-600 cursor-pointer"
                            >
                                <EditIcon className="w-4 h-4" />
                                {isEditing ? "Close Edit" : "Edit"}
                            </button>
                        </div>
                        
                        {isEditing && (
                            <div className="mt-4 pt-3 border-t border-gray-700 animate-fade-in-up">
                                <label className="block text-xs text-gray-400 mb-1">What changes would you like?</label>
                                <div className="flex gap-2 relative z-20">
                                    <input 
                                        type="text" 
                                        autoFocus
                                        value={editInput}
                                        onChange={(e) => setEditInput(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        placeholder="e.g., Add a slide about market trends..."
                                        className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-500 shadow-inner"
                                        onKeyDown={(e) => {
                                            e.stopPropagation();
                                            if (e.key === 'Enter') handleEditSubmit();
                                        }}
                                    />
                                    <button onClick={(e) => { e.stopPropagation(); handleEditSubmit(); }} className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded text-sm font-medium transition-colors text-white shadow-lg">
                                        Update
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {message.attachment && (
                            <img 
                                src={`data:${message.attachment.mimeType};base64,${message.attachment.data}`} 
                                alt="User attachment"
                                className="rounded-lg max-w-xs h-auto" 
                            />
                        )}
                        {!hasHtml && message.type === 'text' && message.content && (
                           <div className="prose prose-invert max-w-none text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(message.content) }} />
                        )}
                        
                        {message.type === 'image' && (
                             <div className="relative group">
                                <img src={message.content} alt="Generated" className="rounded-lg w-full max-w-sm" />
                                <button onClick={() => {
                                    const a = document.createElement('a');
                                    a.href = message.content;
                                    a.download = `pkp-ai-image-${message.id}.png`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                }} className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                    <DownloadIcon className="w-5 h-5" />
                                </button>
                             </div>
                        )}
                        
                         {message.type === 'error' && (
                            <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">
                                {message.content}
                            </div>
                        )}

                        {message.sources && message.sources.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700">
                                <p className="text-xs text-gray-400 font-medium mb-2">Sources:</p>
                                <div className="flex flex-wrap gap-2">
                                    {message.sources.map((source, idx) => (
                                        <a 
                                            key={idx} 
                                            href={source.uri} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="flex items-center gap-1.5 px-2 py-1 bg-gray-900/50 hover:bg-gray-700 rounded text-xs text-indigo-300 transition-colors border border-gray-700"
                                        >
                                            <span className="truncate max-w-[150px]">{source.title}</span>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatView;
