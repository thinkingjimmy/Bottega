"use client";

/**
 * [INPUT]: Depends on React iframe load state, UI Skeleton, and a main-verified fixed gateway origin
 * [OUTPUT]: Provides AppFrame with the generic App sandbox policy and revision-keyed loading lifecycle
 * [POS]: The apps module pure runtime container; it renders fixed origins without learning dynamic upstream ports
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
        sandbox="allow-forms allow-scripts allow-same-origin"
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
