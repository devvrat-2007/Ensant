'use client';
import { useEffect } from 'react';

export default function ThemeInjector() {
  useEffect(() => {
    // The dark "Matte" theme is applied at the CSS layer (globals.css) on
    // :root/html/body, so it is present on first paint with no flash.
    // This effect only tags the document for any theme-aware logic and does
    // NOT mutate the background (which previously forced a second paint).
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  return null;
}
