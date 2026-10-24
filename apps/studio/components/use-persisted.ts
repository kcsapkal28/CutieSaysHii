"use client";
import { useEffect, useState } from "react";

/** A boolean kept in localStorage. Renders `initial` first (so server and client markup match), then loads the saved value. */
export function usePersistedFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) setValue(saved === "1");
    } catch {
      /* storage blocked: the flag just isn't remembered */
    }
  }, [key]);
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return [value, set];
}
