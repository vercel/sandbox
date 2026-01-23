"use client";

import type React from "react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatInputProps {
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
}

export const ChatInput = memo(
  ({ input, onInputChange, onSubmit, disabled }: ChatInputProps) => {
    return (
      <div className="p-4 border-t flex-shrink-0">
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={onInputChange}
            placeholder="Type your message..."
            className="flex-1"
            disabled={disabled}
          />
          <Button type="submit" disabled={disabled}>
            Send
          </Button>
        </form>
      </div>
    );
  },
);

ChatInput.displayName = "ChatInput";
