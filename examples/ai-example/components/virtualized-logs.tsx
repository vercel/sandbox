"use client";

import type React from "react";
import { memo, useMemo, useEffect, useRef } from "react";
import { FixedSizeList as List } from "react-window";

interface VirtualizedLogsProps {
  logs: string[];
  height: number;
}

const LogItem = memo(
  ({
    index,
    style,
    data,
  }: {
    index: number;
    style: React.CSSProperties;
    data: string[];
  }) => (
    <div
      style={style}
      className="font-mono whitespace-nowrap text-sm px-4 flex items-center"
    >
      {data[index]}
    </div>
  ),
);

LogItem.displayName = "LogItem";

export const VirtualizedLogs = memo(
  ({ logs, height }: VirtualizedLogsProps) => {
    const listRef = useRef<List>(null);
    const memoizedLogs = useMemo(() => logs, [logs]);

    // Auto-scroll to bottom when new logs are added
    useEffect(() => {
      if (listRef.current && logs.length > 0) {
        // Small delay to ensure the list has rendered the new items
        const timeoutId = setTimeout(() => {
          listRef.current?.scrollToItem(logs.length - 1, "end");
        }, 50);

        return () => clearTimeout(timeoutId);
      }
    }, [logs.length]);

    if (logs.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500">
          No logs yet...
        </div>
      );
    }

    return (
      <div className="h-full w-full">
        <List
          width="100%"
          ref={listRef}
          height={height}
          itemCount={logs.length}
          itemSize={24}
          itemData={memoizedLogs}
          className="w-full"
          style={{ height: "100%" }}
        >
          {LogItem}
        </List>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.logs.length === nextProps.logs.length &&
      prevProps.height === nextProps.height &&
      (prevProps.logs.length === 0 ||
        prevProps.logs[prevProps.logs.length - 1] ===
          nextProps.logs[nextProps.logs.length - 1])
    );
  },
);

VirtualizedLogs.displayName = "VirtualizedLogs";
