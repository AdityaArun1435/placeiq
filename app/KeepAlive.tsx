'use client';
import { useEffect } from 'react';
import { startKeepAlive } from '@/lib/config';

export default function KeepAlive() {
  useEffect(() => {
    try {
      startKeepAlive();
    } catch (e) {
      console.error('KeepAlive error:', e);
    }
  }, []);
  return null;
}
