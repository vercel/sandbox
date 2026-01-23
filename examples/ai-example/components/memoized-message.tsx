import { memo } from "react";
import { MarkdownHighlighter } from "@/components/highlighter";

interface MessageProps {
  message: {
    id: string;
    role: string;
    parts: Array<{ type: string; text: string }>;
  };
  isStreaming?: boolean;
}

export const MemoizedMessage = memo(
  ({ message, isStreaming = false }: MessageProps) => {
    if (message.role === "assistant") {
      return (
        <>
          {message.parts
            .filter((p) => p.type === "text")
            .map((item, i) => (
              <div
                className="mb-4 flex justify-start"
                key={`${message.id}-${i}`}
              >
                <div className="bg-gray-100 text-gray-900 p-3 rounded-lg max-w-full">
                  <MarkdownHighlighter content={item.text} />
                </div>
              </div>
            ))}
        </>
      );
    }

    return (
      <div
        className={`mb-4 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[85%] p-3 rounded-lg ${
            message.role === "user"
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-900"
          }`}
        >
          {message.parts.map((part, i) => {
            switch (part.type) {
              case "text":
                return <div key={`${message.id}-${i}`}>{part.text}</div>;
              default:
                return null;
            }
          })}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // If either message is currently streaming, always re-render to show incremental updates
    if (prevProps.isStreaming || nextProps.isStreaming) {
      return false;
    }

    // For non-streaming messages, use normal comparison
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.parts.length === nextProps.message.parts.length &&
      prevProps.message.parts.every(
        (part, index) => part.text === nextProps.message.parts[index]?.text,
      )
    );
  },
);

MemoizedMessage.displayName = "MemoizedMessage";
