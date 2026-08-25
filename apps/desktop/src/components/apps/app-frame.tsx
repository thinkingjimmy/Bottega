"use client";

/**
 * [INPUT]: Depends on react iframe load status with ui/skeleton
 * [OUTPUT]: Provides AppFrame, the rendering process has confirmed a healthy fixed gateway origin
 * [POS]: The apps module is a pure operating container, no longer able to detect or access dynamic internal ports on its own
 */

import { useState } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";

function Frame({
  origin,
  name,
}: {
  origin: string;
  name: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative size-full">
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      <iframe
        src={origin}
        title={name}
        className="size-full border-0"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export function AppFrame({
  origin,
  name,
  revision,
}: {
  origin: string;
  name: string;
  revision: number;
}) {
  return <Frame key={`${origin}-${revision}`} origin={origin} name={name} />;
}
