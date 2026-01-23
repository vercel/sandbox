"use client";

import type React from "react";
import { memo } from "react";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onMouseDown: (e: React.MouseEvent) => void;
}

export const ResizeHandle = memo(
  ({ direction, onMouseDown }: ResizeHandleProps) => {
    const isHorizontal = direction === "horizontal";

    return (
      <div
        className={`${
          isHorizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
        } bg-gray-200 hover:bg-blue-300 flex-shrink-0 relative group transition-colors`}
        onMouseDown={onMouseDown}
      >
        <div
          className={`absolute ${
            isHorizontal
              ? "inset-y-0 -left-2 -right-2"
              : "inset-x-0 -top-2 -bottom-2"
          } group-hover:bg-blue-200 transition-colors`}
        />
      </div>
    );
  },
);

ResizeHandle.displayName = "ResizeHandle";
