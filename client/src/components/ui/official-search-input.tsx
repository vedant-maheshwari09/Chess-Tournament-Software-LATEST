"use client";

import { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import type { FideDirectoryEntry } from "@shared/fide-types";

export interface OfficialSearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function OfficialSearchInput({ value, onChange }: OfficialSearchInputProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<FideDirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    const timeoutId = setTimeout(() => {
      setIsLoading(true);
      fetch(`/api/officials/search?q=${encodeURIComponent(query)}`, { signal })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setResults(data);
          }
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            console.error("Failed to search officials", err);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 300); // Debounce for 300ms

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (official: FideDirectoryEntry) => {
    const officialName = official.name
      .split(',')
      .map(s => s.trim())
      .reverse()
      .join(' ');
    onChange(officialName);
    setQuery(officialName);
    setIsDropdownOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsDropdownOpen(true);
          onChange(e.target.value); // Keep form state updated while typing
        }}
        onFocus={() => setIsDropdownOpen(true)}
        placeholder="Search by name..."
      />
      {isDropdownOpen && (query.length >= 3 || isLoading) && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg">
          {isLoading ? (
            <div className="p-2 text-sm text-slate-500">Searching...</div>
          ) : results.length > 0 ? (
            <ul className="py-1">
              {results.map((official) => (
                <li
                  key={official.fideId}
                  onClick={() => handleSelect(official)}
                  className="px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  {official.name} ({official.federation})
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-2 text-sm text-slate-500">No results found.</div>
          )}
        </div>
      )}
    </div>
  );
}
