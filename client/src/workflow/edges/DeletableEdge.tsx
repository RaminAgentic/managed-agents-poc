import { useCallback, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";

/**
 * Custom edge that renders a smooth-step path with:
 *  - Visual highlight when selected (bright blue + thicker stroke)
 *  - A small "×" delete button that appears on hover/select
 *
 * Delete via keyboard (Backspace/Delete) is handled by React Flow's
 * built-in `deleteKeyCode` prop + `onEdgesDelete` callback in the parent.
 */
export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style = {},
  markerEnd,
  interactionWidth = 20,
}: EdgeProps<Edge>) {
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      setEdges((edges) => edges.filter((e) => e.id !== id));
    },
    [id, setEdges],
  );

  const showButton = selected || hovered;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        style={{
          ...style,
          stroke: selected ? "#3b82f6" : hovered ? "#60a5fa" : (style.stroke ?? "#94a3b8"),
          strokeWidth: selected ? 3 : hovered ? 2.5 : (typeof style.strokeWidth === "number" ? style.strokeWidth : 2),
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
      />
      {/* Invisible wider hover area to detect mouse enter/leave on the edge path */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ pointerEvents: "stroke" }}
      />
      <EdgeLabelRenderer>
        <button
          className={`edge-delete-btn${showButton ? " edge-delete-btn--visible" : ""}`}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          onClick={onDelete}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Delete edge"
          aria-label="Delete edge"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
