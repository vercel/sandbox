"use client";

import { memo, useEffect, useRef } from "react";
import { MemoizedMessage } from "./memoized-message";

interface ChatMessagesProps {
  messages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text: string }>;
  }>;
  status: string;
}

export const ChatMessages = memo(
  ({ messages, status }: ChatMessagesProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const timeoutId = setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 50);

      return () => clearTimeout(timeoutId);
    }, [messages, status]);

    return (
      <div className="p-4 w-full overflow-y-scroll flex-1">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="mb-2 text-xl">👋 Hola!</p>
            <p>Let's test Vercel Sandbox</p>
          </div>
        )}

        {messages.map((message, index) => {
          // Check if this is the last message and we're currently streaming
          const isLastMessage = index === messages.length - 1;
          const isStreaming = status === "streaming" && isLastMessage;

          return (
            <MemoizedMessage
              key={message.id}
              message={message}
              isStreaming={isStreaming}
            />
          );
        })}

        {status === "streaming" && (
          <div className="flex justify-start mb-4">
            <div className="bg-gray-100 text-gray-900 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                ></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                ></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    );
  },
  // Remove the aggressive memoization that was blocking updates
  (prevProps, nextProps) => {
    // Only prevent re-render if nothing has actually changed
    return (
      prevProps.messages.length === nextProps.messages.length &&
      prevProps.status === nextProps.status &&
      // For streaming, always allow re-render
      nextProps.status !== "streaming"
    );
  },
);

ChatMessages.displayName = "ChatMessages";
