import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Minimize2, Users, Loader2 } from 'lucide-react';

/**
 * ChatPanel - Floating chat widget untuk admin berkomunikasi dengan siswa
 * Features:
 * - Broadcast message ke semua siswa yang sedang login
 * - Menerima reply dari siswa
 * - Minimize/maximize panel
 * - Real-time via socket.io
 */
export default function ChatPanel({ socket, onlineCount: externalOnlineCount = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const openPanel = () => setIsOpen(true);
    window.addEventListener('labkom:open-chat', openPanel);
    return () => window.removeEventListener('labkom:open-chat', openPanel);
  }, []);

  // Auto scroll ke pesan terbaru
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleClientMessage = (data) => {
      const { pc_name, student_name, message: msg, timestamp } = data;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: 'received',
          from: student_name || pc_name,
          pc_name,
          message: msg,
          timestamp: timestamp || new Date().toISOString(),
        },
      ]);
    };

    // Update jumlah client online dari presence events
    const onlineClients = new Map();
    const handlePresence = (data) => {
      if (!data?.pc_name) return;
      if (data.is_online) {
        onlineClients.set(data.pc_name, true);
      } else {
        onlineClients.delete(data.pc_name);
      }
      setOnlineCount(onlineClients.size);
    };

    socket.on('chat:message-from-client', handleClientMessage);
    socket.on('presence:update', handlePresence);

    return () => {
      socket.off('chat:message-from-client', handleClientMessage);
      socket.off('presence:update', handlePresence);
    };
  }, [socket]);

  // Focus input saat panel dibuka
  useEffect(() => {
    if (isOpen && !isMinimized) {
      inputRef.current?.focus();
    }
  }, [isOpen, isMinimized]);

  const handleSend = () => {
    if (!message.trim() || !socket || sending) return;

    setSending(true);
    const messageData = {
      message: message.trim(),
      timestamp: new Date().toISOString(),
    };

    // Broadcast ke semua client via socket
    socket.emit('admin:broadcast-message', messageData, (response) => {
      if (response?.success) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: 'sent',
            from: 'Admin',
            message: message.trim(),
            timestamp: messageData.timestamp,
            delivered: response.count || 0,
          },
        ]);
        setMessage('');
      }
      setSending(false);
    });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Floating chat button
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-300 ${
        isMinimized ? 'w-80 h-16' : 'w-96 h-[600px]'
      }`}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 rounded-t-2xl flex items-center justify-between text-white">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base">Chat dengan Siswa</h3>
            <p className="text-xs text-blue-100 flex items-center space-x-1">
              <Users className="w-3 h-3" />
              <span>{Number.isFinite(externalOnlineCount) ? externalOnlineCount : onlineCount} siswa online</span>
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            title={isMinimized ? 'Maximize' : 'Minimize'}
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            title="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center">
                <div>
                  <MessageCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 font-medium">
                    Belum ada percakapan
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Pesan akan terkirim ke semua siswa yang sedang login
                  </p>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.type === 'sent' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[80%] ${
                      msg.type === 'sent'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-200'
                    } rounded-2xl px-4 py-2.5 shadow-sm`}
                  >
                    {msg.type === 'received' && (
                      <p className="text-xs font-semibold text-blue-600 mb-1">
                        {msg.from} • {msg.pc_name}
                      </p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {msg.message}
                    </p>
                    <div
                      className={`flex items-center justify-between mt-1 space-x-2 ${
                        msg.type === 'sent'
                          ? 'text-blue-100'
                          : 'text-slate-400'
                      }`}
                    >
                      <span className="text-xs">{formatTime(msg.timestamp)}</span>
                      {msg.type === 'sent' && msg.delivered !== undefined && (
                        <span className="text-xs">
                          Terkirim ke {msg.delivered} siswa
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-slate-200 bg-white rounded-b-2xl">
            <div className="flex items-end space-x-2">
              <div className="flex-1">
                <textarea
                  ref={inputRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ketik pesan untuk broadcast ke semua siswa..."
                  rows={2}
                  disabled={sending || !socket}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!message.trim() || sending || !socket}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl transition-colors flex items-center justify-center space-x-2 disabled:cursor-not-allowed h-[72px]"
                title="Kirim pesan (Enter)"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Tekan <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs font-mono">Enter</kbd> untuk kirim
            </p>
          </div>
        </>
      )}
    </div>
  );
}
