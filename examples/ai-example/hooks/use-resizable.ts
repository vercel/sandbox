"use client";

import type React from "react";

import { useState, useCallback, useRef, useEffect } from "react";

export function useResizable() {
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [rightTopHeight, setRightTopHeight] = useState(50);
  const [isResizingHorizontal, setIsResizingHorizontal] = useState(false);
  const [isResizingVertical, setIsResizingVertical] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [startLeftWidth, setStartLeftWidth] = useState(50);
  const [startTopHeight, setStartTopHeight] = useState(50);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleHMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizingHorizontal(true);
      setStartX(e.clientX);
      setStartLeftWidth(leftPanelWidth);
    },
    [leftPanelWidth],
  );

  const handleVMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizingVertical(true);
      setStartY(e.clientY);
      setStartTopHeight(rightTopHeight);
    },
    [rightTopHeight],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return;

      if (isResizingHorizontal) {
        const containerWidth = containerRef.current.offsetWidth;
        const deltaX = e.clientX - startX;
        const deltaPercent = (deltaX / containerWidth) * 100;
        const newWidth = startLeftWidth + deltaPercent;
        const constrainedWidth = Math.max(10, Math.min(90, newWidth));
        setLeftPanelWidth(constrainedWidth);
      }

      if (isResizingVertical) {
        const containerHeight = containerRef.current.offsetHeight;
        const deltaY = e.clientY - startY;
        const deltaPercent = (deltaY / containerHeight) * 100;
        const newHeight = startTopHeight + deltaPercent;
        const constrainedHeight = Math.max(10, Math.min(90, newHeight));
        setRightTopHeight(constrainedHeight);
      }
    },
    [
      isResizingHorizontal,
      isResizingVertical,
      startX,
      startY,
      startLeftWidth,
      startTopHeight,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizingHorizontal(false);
    setIsResizingVertical(false);
  }, []);

  useEffect(() => {
    if (isResizingHorizontal || isResizingVertical) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        e.preventDefault();
        handleMouseMove(e);
      };

      const handleGlobalMouseUp = (e: MouseEvent) => {
        e.preventDefault();
        handleMouseUp();
      };

      document.addEventListener("mousemove", handleGlobalMouseMove, {
        passive: false,
      });
      document.addEventListener("mouseup", handleGlobalMouseUp, {
        passive: false,
      });
      document.body.style.cursor = isResizingHorizontal
        ? "col-resize"
        : "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.pointerEvents = "none";

      return () => {
        document.removeEventListener("mousemove", handleGlobalMouseMove);
        document.removeEventListener("mouseup", handleGlobalMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.pointerEvents = "";
      };
    }
  }, [
    isResizingHorizontal,
    isResizingVertical,
    handleMouseMove,
    handleMouseUp,
  ]);

  return {
    leftPanelWidth,
    rightTopHeight,
    handleHMouseDown,
    handleVMouseDown,
    containerRef,
  };
}
