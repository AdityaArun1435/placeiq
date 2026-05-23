'use client';
import { useEffect } from 'react';
import { startKeepAlive } from '@/lib/config';

export default function KeepAlive() {
  useEffect(() => {
    startKeepAlive();
  }, []);
  return null;
}
