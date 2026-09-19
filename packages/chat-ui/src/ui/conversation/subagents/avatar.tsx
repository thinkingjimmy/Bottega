/**
 * [INPUT]: Depends on React canvas, the shared identity recipe and backend icons.
 * [OUTPUT]: Provides AgentAvatar and SubagentAvatar with deterministic visual identity.
 * [POS]: conversation/subagents' visual identity, consumed by its list and detail siblings.
 */

import { AgentBackendIcon, backendLabel } from "@ai-chat/ui/components/identity/agent";
import type { SubagentProjection } from "./merge";
type AgentBackendId = NonNullable<SubagentProjection["meta"]["agent"]>;
import { useEffect, useRef } from "react";
import { cn } from "@ai-chat/ui/lib/utils";
import { agentAvatarRecipe } from "./recipe";

export function AgentAvatar({
  identity,
  size = 32,
  className,
}: {
  identity: string;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const density = 2;
    canvas.width = size * density;
    canvas.height = size * density;
    const recipe = agentAvatarRecipe(identity);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.scale(density, density);
    context.translate(size / 2, size / 2);
    context.rotate(recipe.rotation);
    const radius = size * 0.47;
    const inner = radius * recipe.inset;

    for (let index = 0; index < 8; index += 1) {
      context.save();
      context.rotate((Math.PI * 2 * index) / 8);
      context.beginPath();
      context.moveTo(-inner, 0);
      context.bezierCurveTo(
        -radius * recipe.twist,
        -radius * 0.34,
        -radius * 0.24,
        -radius * 0.72,
        0,
        -radius
      );
      context.bezierCurveTo(
        radius * 0.24,
        -radius * 0.72,
        radius * recipe.twist,
        -radius * 0.34,
        inner,
        0
      );
      context.closePath();
      context.fillStyle = recipe.palette[index % recipe.palette.length];
      context.fill();
      context.strokeStyle = "rgba(255,255,255,.86)";
      context.lineWidth = Math.max(0.75, size / 32);
      context.stroke();
      context.restore();
    }
  }, [identity, size]);

  return (
    <canvas
      aria-hidden="true"
      className={cn("shrink-0", className)}
      ref={canvasRef}
      style={{ height: size, width: size }}
    />
  );
}

export function SubagentAvatar({ agentThreadId, agent, size = 20, className, label }: { agentThreadId: string; agent?: AgentBackendId; size?: number; className?: string; label?: string }) {
  return agent ? <AgentBackendIcon backend={agent} aria-label={label ?? backendLabel(agent)} className={cn("shrink-0", className)} style={{ height: size, width: size }} /> : <AgentAvatar identity={agentThreadId} size={size} className={className} />;
}
